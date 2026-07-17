// -------------------------------------------------------------------------
// Ninja Chat moderation — bad-word list lives ENTIRELY in Firebase at
// "moderation/badWords" as a single comma-separated string (e.g. "a,b,c,d").
// Nothing profane is stored in this file. Until the Firebase list loads,
// the cache is just empty, so the filter is a no-op (fails open, not closed).
// -------------------------------------------------------------------------
window._cnBadWordsCache = [];

window.fbModeration = {
  async loadBadWords(){
    try{
      const snap = await db.ref("moderation/badWords").once("value");
      const val = snap.val();
      let raw = null;

      if(typeof val === "string"){
        raw = val;
      } else if(Array.isArray(val)){
        raw = val.join(",");
      } else if(val && typeof val === "object"){
        raw = Object.values(val).join(",");
      }

      if(raw){
        const list = raw
          .split(",")
          .map(w => String(w).trim().toLowerCase())
          .filter(Boolean);
        if(list.length) window._cnBadWordsCache = list;
      }
    }catch(e){ /* keep whatever cache we already had */ }
    return window._cnBadWordsCache;
  },
  // Records a flagged message and immediately bans the account key so the
  // student is signed out and can't log back in until a Sensei unbans them.
  async flagAndBan(username, accountKey, text){
    const flagRef = db.ref("moderation/flags").push();
    await flagRef.set({username: username||"", accountKey: accountKey||"", text: text||"", ts: Date.now(), status:"banned"});
    if(accountKey){
      await db.ref(`moderation/bans/${accountKey}`).set({banned:true, flagId:flagRef.key, ts:Date.now()});
    }
    return flagRef.key;
  },
  async setBan(accountKey, banned, flagId){
    if(!accountKey) return;
    if(banned){ await db.ref(`moderation/bans/${accountKey}`).set({banned:true, flagId:flagId||null, ts:Date.now()}); }
    else{ await db.ref(`moderation/bans/${accountKey}`).remove(); }
    if(flagId){ await db.ref(`moderation/flags/${flagId}`).update({status: banned?"banned":"unbanned"}); }
  },
  async isBanned(accountKey){
    if(!accountKey) return false;
    try{
      const snap = await db.ref(`moderation/bans/${accountKey}`).once("value");
      const v = snap.val();
      return !!(v && v.banned);
    }catch(e){ return false; }
  },
  listenFlags(callback){
    const ref = db.ref("moderation/flags").limitToLast(200);
    const handler = snap=>{
      const val = snap.val()||{};
      const list = Object.entries(val).map(([id,f])=>({id,...f})).sort((a,b)=>(b.ts||0)-(a.ts||0));
      callback(list);
    };
    ref.on("value",handler);
    return ()=>ref.off("value",handler);
  }
};
// Kick off a load right away so the freshest list is ready before anyone types.
window.fbModeration.loadBadWords();
