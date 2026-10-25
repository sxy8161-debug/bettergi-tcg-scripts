// Reused native four-slot structure/counter reader. The asset key retains its
// original Ailin name; it is the same reviewed border, not another classifier.
// @fragment bgi-host.supportSlotsIn
supportSlotsIn(f){
      const slots=[];
      for(let index=0;index<4;index++){
        const col=index%2,row=Math.floor(index/2),y=600+198*row,
          // The hand's tall right-edge crop includes artwork/glints on these
          // small cards. Read the support's short left border first, outside
          // the artwork; keep the existing right rim as a second structure.
          left=this.matches(f,"ailin/support-rim",this.roi("board",[248+164*col,585+190*row,30,165]),.90,false),
          rims=left.length?left:this.matches(f,"hand_rim",this.roi("board",[305+170*col,585+198*row,100,175]),.85,false),
          // The badge is fixed to the slot, not to a successfully matched rim
          // or a remembered owner. The old no-rim crop cut its right half and
          // could turn an occupied cooking slot into a confirmed departure.
          counter=number(this.numericAt(f,this.roi("board",[350+170*col,y-25,80,90]),3)),
          conflict=rims.length>1&&Math.max(...rims.map(r=>r.x))-Math.min(...rims.map(r=>r.x))>12;
        slots.push({index,present:conflict?null:rims.length>0||counter!==null,counter});
      }
      return {source:"native-support-rims",known:slots.every(s=>s.present!==null),
        count:slots.filter(s=>s.present===true).length,slots};
    }
// @endfragment bgi-host.supportSlotsIn
