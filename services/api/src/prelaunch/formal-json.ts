/** Stable JSON for evidence stored in jsonb (whose object-key order is not retained). */
export function formalCanonicalJson(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(formalCanonicalJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)
  .map(([k,v])=>JSON.stringify(k)+':'+formalCanonicalJson(v)).join(',')+'}';
 return JSON.stringify(value);
}
