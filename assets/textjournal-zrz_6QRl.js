var e=`yorozu_journal_base`;function t(t){if(!t)return{base:0,lines:[]};let n=t.split(`
`).filter(e=>e.trim()!==``),r=n[0];if(r?.includes(e))try{let t=JSON.parse(r)[e];if(typeof t==`number`&&Number.isInteger(t)&&t>=0)return{base:t,lines:n.slice(1)}}catch{}return{base:0,lines:n}}function n(t,n){let r=[...t>0?[`{"${e}":${t}}`]:[],...n];return r.length>0?`${r.join(`
`)}\n`:``}export{n,t};