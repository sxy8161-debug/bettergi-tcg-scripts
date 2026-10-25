// Named card choices and their payment/target subpages share the existing
// confirmationSession. Classification, ranking and exit effects remain deck-owned.
    namedChoiceOptionsIn(f){
      const header=T.norm(this.ocr(f,this.roi("header", [700,155,520,130])));
      if(!header.includes("挑选卡牌")||!header.includes("请选择一张卡牌"))return null;
      const options=[];
      for(const r of this.ocrRows(f,this.roi("choice", [150,705,1620,90]))){
        if(!r.text||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=0||r.h<=0)continue;
        const point=[Math.round(r.x+r.w/2),Math.round(r.y+r.h/2-200)];
        const reference=this.referencePoint("choice",...point);
        if(reference[0]<150||reference[0]>1770||reference[1]<470||reference[1]>650)continue;
        const detail=this.choiceDetails.find(d=>d.title===r.text&&Math.abs(d.point[0]-point[0])<=8),
          card=detail?T.byId[detail.id]:T.identify(r.text);
        options.push({id:card?.id||null,name:card?.name||null,title:r.text,point,inspected:!!detail});
      }
      options.sort((a,b)=>a.point[0]-b.point[0]);
      return options;
    }
    async resolveChoice(before=null,memory=this.memory){
      let stable=0,key="",last=null;
      for(let attempt=0;attempt<24;attempt++){
        const sampledAt=Date.now(),revision=this.inputRevision;
        const session=this.choiceSession;let sampledPreview=null;
        last=this.phase((f,phase)=>{
          if(["payment","target"].includes(session?.kind)&&phase.phase==="unknown"&&phase.turn==="none")
            sampledPreview=this.cardChoicePreviewIn(f,session.kind,phase);
        });
        if(session&&!session.origin)session.origin=this.confirmationSession?.key||null;
        // A submitted drag or inspection can return to the board without a
        // target/confirmation ever appearing. Keep its owner until the actual
        // board AND hand are read; the shared confirmation then verifies the
        // effect instead of waiting forever or submitting the card again.
        let reconciled=false;
        const unconfirmedPage=session&&!session.confirmed&&["target","payment","inspect"].includes(session.kind);
        if(unconfirmedPage&&last.phase==="board"&&last.turn==="user"){
          last=await this.observe(true,{mode:"full"});
          if(last.phase!=="board"||last.turn!=="user"||!T.legalState(last)){stable=0;key="";continue;}
          reconciled=true;
        }
        if(session?.kind==="payment"&&session.confirmed&&last.phase==="choice"){
          // Payment is finished; the same pending action now owns the native choice.
          // Do not require an intermediate board frame or resend the payment.
          this.choiceSession=null;stable=0;key="";continue;
        }
        const handoff=unconfirmedPage&&(last.turn==="enemy"||["pick","roll","settlement","result"].includes(last.phase));
        if(session?.kind==="inspect"&&!reconciled&&!handoff){
          const title=last.phase==="choice"?this.frame(f=>this.titleIn(f,[45,115,360,50])):"",card=T.identify(title);
          if(title!==session.title){session.title=title;this.trace("choice-title-observed",{title,id:card?.id||null,point:session.option.point});}
          const sameSlot=last.options?.some(o=>o.title===session.option.title&&Math.abs(o.point[0]-session.option.point[0])<=8);
          const next=sameSlot&&card?.type===this.choiceInspectionType?card.id:"";
          stable=next&&next===key?stable+1:next?1:0;key=next;
          if(stable>=2){this.choiceDetails.push({...session.option,id:card.id});this.choiceSession=null;
            this.trace("choice-title-read",{title:card.name,point:session.option.point});stable=0;key="";}
          else if(sameSlot&&!next&&++session.misses>=3){
            this.choiceDetails.push({...session.option,id:null});this.choiceSession=null;
            this.trace("choice-option-unresolved",{title,point:session.option.point,reason:"bounded-title-inspection"});
            stable=0;key="";
          }
          if(attempt<23)await this.waitForSample(sampledAt,250,revision);continue;
        }
        const exited=session&&(session.selected||session.confirmed||reconciled||handoff)&&["board","pick","roll","settlement","result"].includes(last.phase)&&
          (last.phase!=="board"||["user","enemy"].includes(last.turn));
        if(exited){
          const next=JSON.stringify([last.phase,last.turn,last.result]);stable=next===key?stable+1:1;key=next;
          if(stable>=2||reconciled){
            this.choiceSession=null;this.choiceDetails=[];this.choiceReceipt={origin:session.origin,id:session.id,kind:session.kind,exited:true};
            if((reconciled||handoff)&&session.kind==="inspect")this.choiceReceipt.unresolved=true;
            this.onChoiceExit(session,memory);
            if(!reconciled){
              this.invalidateHand("named-choice-result");this.handFanReady=false;this.handNeedsReset=true;this.boardReady=false;
            }
            this.trace("choice-resolved",{...this.choiceReceipt,confirmationInputs:session.confirmed?1:0,
              ...(reconciled||handoff?{recovery:reconciled?"complete-native-board-and-hand":"native-phase-handoff",replayedAction:false}:{})});return last;
          }
        }else if(session?.kind==="payment"){
          const preview=sampledPreview||this.frame(f=>this.cardChoicePreviewIn(f,"payment"));
          const matched=preview.phase.phase==="unknown"&&preview.phase.turn==="none"&&
            preview.controls.length===1&&T.nativeCardScope(session.action,preview.banner,before);
          if(matched&&!session.confirmed){session.confirmed=true;const c=preview.controls[0];
            this.clickAt(c.x+c.w/2,c.y+c.h/2);this.markNativeCardConfirmation(session.action,"central");
            stable=0;key="";await sleep(120);}
        }else if(session?.kind==="target"){
          const preview=sampledPreview||this.frame(f=>this.cardChoicePreviewIn(f,"target"));
          {
            const native=preview;
            const key="target-unresolved:"+session.id+":"+session.selected;
            const controls=native.controls.length?native.controls:native.buttons;
            if(!session.confirmed&&(!this.choiceTargetBanners[T.byId[session.id].type].includes(native.banner)||
                session.selected&&controls.length!==1)&&!this.diagnosticKeys.has(key)){
              this.diagnosticKeys.add(key);
              this.trace("card-target-unresolved",{id:session.id,target:session.target,selected:session.selected,...native});
            }
          }
          // The submitted card already owns this target session. Native equipment
          // pages have no title panel, including after the character is selected.
          const matched=preview.phase.phase==="unknown"&&preview.phase.turn==="none"&&
            this.choiceTargetBanners[T.byId[session.id].type].includes(preview.banner);
          const controls=preview.controls.length?preview.controls:preview.buttons;
          const otherTarget=Object.values(this.choiceTargetBanners).some(labels=>labels.includes(preview.banner))&&
            !this.choiceTargetBanners[T.byId[session.id].type].includes(preview.banner);
          // The current page owns the selected target; use its first ready control.
          if(matched&&!session.selected){session.selected=true;this.clickAt(...this.point("board",charX[session.target],720));
            this.trace("card-target-clicked",{id:session.id,target:session.target,banner:preview.banner});stable=0;key="";await sleep(120);}
          else if(!otherTarget&&preview.phase.phase==="unknown"&&preview.phase.turn==="none"&&session.selected&&!session.confirmed&&controls.length===1){
            session.confirmed=true;const c=controls[0];this.clickAt(c.x+c.w/2,c.y+c.h/2);
            this.markNativeCardConfirmation(session.action,"targeted");stable=0;key="";await sleep(120);
          }
        }else if(session&&!session.confirmed&&["choice","unknown"].includes(last.phase)){
          const preview=this.frame(f=>({phase:this.phaseIn(f),buttons:this.matches(f,"core/确定",this.roi("choice", [500,800,920,240]))}));
          if(["choice","unknown"].includes(preview.phase.phase)&&preview.phase.turn==="none"&&preview.buttons.length===1){session.confirmed=true;const c=preview.buttons[0];this.clickAt(c.x+c.w/2,c.y+c.h/2);stable=0;key="";await sleep(120);}
        }else if(!session&&last.phase==="choice"&&last.recognized){
          const origin=this.confirmationSession?.plan?.action,
            ranked=T.generatedChoices(last.options.filter(o=>o.id),before||this.lastObservedState,memory,origin?(origin.cardAction||origin):null),
            id=ranked[0]?.id,target=last.options.find(o=>o.id===id);
          if(target){this.choiceSession={id,kind:last.choiceKind,origin:this.confirmationSession?.key||null,selected:true,confirmed:false,
              oldCount:this.frame(f=>this.nativeHandCountIn(f))};
            const inspected=this.choiceDetails.at(-1),reuse=inspected?.id===id&&Math.abs(inspected.point[0]-target.point[0])<=8;
            if(!reuse)this.clickAt(...target.point);
            this.trace("choice-selected",{id,kind:last.choiceKind,reusedInspection:reuse,candidates:ranked});stable=0;key="";await sleep(120);}
        }else if(!session&&last.phase==="choice"&&last.inspectable){
          const option=last.options.find(o=>!o.id&&!o.inspected);
          if(option){this.choiceSession={kind:"inspect",option,misses:0,origin:this.confirmationSession.key};
            this.clickAt(...option.point);this.trace("choice-inspect",{title:option.title,point:option.point});stable=0;key="";await sleep(120);}
        }else{stable=0;key="";}
        if(attempt<23)await this.waitForSample(sampledAt,250,revision);
      }
      const e=Error("卡牌选择页尚未完成，保留已发送输入");e.code="TCG_CHOICE_RETRY";e.phase=last;throw e;
    }
    async cardConfirm(a,before){
      await this.requireNoWarning();const p=this.phase();if(p.phase==="choice")return;
      const type=T.byId[a.id].type;
      if(this.choiceTargetBanners[type]){
        this.choiceSession={kind:"target",id:a.id,target:a.target,action:a,origin:null,selected:false,confirmed:false};return;
      }
      if(p.result||p.phase==="board"&&p.turn==="user")return;
      // The drag has already been submitted. The existing choice owner completes
      // payment when its native scope/control is readable; never drag the card again.
      this.choiceSession={kind:"payment",id:a.id,action:a,origin:null,selected:true,confirmed:false};
    }
