module.exports=[924868,(e,t,r)=>{t.exports=e.x("fs/promises",()=>require("fs/promises"))},814747,(e,t,r)=>{t.exports=e.x("path",()=>require("path"))},248969,e=>{"use strict";function t(e,i={}){let a,o={fallbackMessage:"Unknown error",maxDepth:5,supportSerialization:!0,serializeStack:!0},s=i?{...o,...i}:o,{fallbackMessage:n,maxDepth:d,supportSerialization:l,serializeStack:c}=s;if(e&&e instanceof Error)return l&&r(e,c,{maxDepth:d}),e;if(e&&"object"==typeof e){let r=e&&"message"in e&&"string"==typeof e.message?e.message:function(e){if("object"!=typeof e||null===e)return String(e);try{let t=JSON.stringify(e);if("{}"===t)return String(e);return t}catch{return String(e)}}(e),i="cause"in e&&void 0!==e.cause?e.cause instanceof Error?e.cause:d>0?t(e.cause,{...s,maxDepth:d-1}):void 0:void 0;Object.assign(a=Error(r,i?{cause:i}:void 0),e),a.stack="stack"in e&&"string"==typeof e.stack?e.stack:void 0}else e&&"string"==typeof e?(a=Error(e)).stack=void 0:a=Error(n);return l&&r(a,c,{maxDepth:d}),a}function r(e,t=!0,i){let a=i?.maxDepth??5,o=i?.currentDepth??0;e.toJSON||(e.cause instanceof Error&&o<a&&r(e.cause,t,{maxDepth:a,currentDepth:o+1}),Object.defineProperty(e,"toJSON",{value:function(){let e={message:this.message,name:this.name};for(let r in t&&void 0!==this.stack&&(e.stack=this.stack),void 0!==this.cause&&(this.cause instanceof Error&&"toJSON"in this.cause&&"function"==typeof this.cause.toJSON?e.cause=this.cause.toJSON():e.cause=this.cause),this)!this.hasOwnProperty(r)||r in e||"toJSON"===r||(e[r]=this[r]);return e},enumerable:!1,writable:!0,configurable:!0}))}let i=((o={}).TOOL="TOOL",o.AGENT="AGENT",o.MCP="MCP",o.AGENT_NETWORK="AGENT_NETWORK",o.MASTRA_SERVER="MASTRA_SERVER",o.MASTRA_OBSERVABILITY="MASTRA_OBSERVABILITY",o.MASTRA_WORKFLOW="MASTRA_WORKFLOW",o.MASTRA_VOICE="MASTRA_VOICE",o.MASTRA_VECTOR="MASTRA_VECTOR",o.MASTRA_MEMORY="MASTRA_MEMORY",o.LLM="LLM",o.EVAL="EVAL",o.SCORER="SCORER",o.A2A="A2A",o.MASTRA_INSTANCE="MASTRA_INSTANCE",o.MASTRA="MASTRA",o.DEPLOYER="DEPLOYER",o.STORAGE="STORAGE",o.MODEL_ROUTER="MODEL_ROUTER",o),a=((s={}).UNKNOWN="UNKNOWN",s.USER="USER",s.SYSTEM="SYSTEM",s.THIRD_PARTY="THIRD_PARTY",s);var o,s,n=class extends Error{id;domain;category;details={};message;cause;constructor(e,r){const i=r?t(r,{serializeStack:!1,fallbackMessage:"Unknown error"}):void 0,a=e.text??i?.message??"Unknown error";super(a,{cause:i}),this.id=e.id,this.domain=e.domain,this.category=e.category,this.details=e.details??{},this.message=a,this.cause=i,Object.setPrototypeOf(this,new.target.prototype)}toJSONDetails(){return{message:this.message,domain:this.domain,category:this.category,details:this.details}}toJSON(){return{message:this.message,domain:this.domain,category:this.category,code:this.id,details:this.details,cause:this.cause?.toJSON?.()}}toString(){return JSON.stringify(this.toJSON())}},d=class extends Error{isNonRetryable=!0;constructor(e,t){super(e,t),this.name="MastraNonRetryableError",Object.setPrototypeOf(this,new.target.prototype)}};e.s(["a",0,d,"i",0,class extends n{},"n",0,i,"o",0,t,"t",0,a])},641907,e=>{"use strict";var t=e.i(248969);function r(e){return e.getId?.()??e.id}e.s(["a",0,function(e){return`${encodeURIComponent(e)}.json`},"i",0,function(e){return e.shouldEnable?.()??!0},"n",0,r,"r",0,function(e){return!!(e?.apiKey||e?.bearerToken||e?.headers&&Object.keys(e.headers).length>0)},"t",0,function(e,i){let a=i.find(t=>{let i=r(t);return"models.dev"!==i&&(i===e||e.startsWith(`${i}/`))});if(a)return a;let o=i.find(t=>"models.dev"!==r(t)&&t.handlesModel?.(e)===!0);if(o)return o;let s=i.find(e=>"models.dev"===r(e));if(s)return s;throw new t.i({id:"MODEL_ROUTER_NO_GATEWAY_FOUND",category:"USER",domain:"MODEL_ROUTER",text:`No Mastra model router gateway found for model id ${e}`})}])},581052,e=>{"use strict";var t=e.i(641907),r=e.i(814747),i=e.i(924868);let a=[25,50,100,200,400];async function o(e,t,r="utf-8"){let s=Math.random().toString(36).substring(2,15),n=`${e}.${process.pid}.${Date.now()}.${s}.tmp`;try{await i.default.writeFile(n,t,r);for(let t=0;;t+=1)try{await i.default.rename(n,e);break}catch(r){let e=a[t];if(!("win32"===process.platform&&r instanceof Error&&"code"in r&&("EPERM"===r.code||"EBUSY"===r.code))||void 0===e)throw r;await new Promise(t=>setTimeout(t,e))}}catch(e){try{await i.default.unlink(n)}catch{}throw e}}async function s(e){let r=[];for(let i of e)(0,t.i)(i)&&r.push(i);let i={},a={},o={},s={},n={},d=[];for(let e of r){let r=null;for(let t=1;t<=3;t++)try{r=await e.fetchProviders();break}catch{if(t<3){let e=Math.min(1e3*Math.pow(2,t-1),5e3);await new Promise(t=>setTimeout(t,e))}}if(!r){d.push((0,t.n)(e));continue}let l=(0,t.n)(e),c="models.dev"===l,u="getAttachmentCapabilities"in e&&"function"==typeof e.getAttachmentCapabilities?e.getAttachmentCapabilities():void 0,p="getTemperatureCapabilities"in e&&"function"==typeof e.getTemperatureCapabilities?e.getTemperatureCapabilities():void 0,f="getStructuredOutputCapabilities"in e&&"function"==typeof e.getStructuredOutputCapabilities?e.getStructuredOutputCapabilities():void 0;for(let[e,t]of Object.entries(r)){let r=c?e:e===l?l:`${l}/${e}`;i[r]=t,a[r]=t.models.sort(),u?.[e]&&(o[r]=u[e]),p?.[e]&&(s[r]=p[e]),f?.[e]&&(n[r]=f[e])}}return{providers:i,models:a,attachmentCapabilities:o,temperatureCapabilities:s,structuredOutputCapabilities:n,failedGateways:d}}async function n(e,a,s,n,d,l,c){let u=r.default.dirname(e),p=r.default.dirname(a);await i.default.mkdir(u,{recursive:!0}),await i.default.mkdir(p,{recursive:!0}),await o(e,JSON.stringify({providers:s,models:n,version:"1.0.0"},null,2),"utf-8"),await o(a,`/**
 * THIS FILE IS AUTO-GENERATED - DO NOT EDIT
 * Generated from model gateway providers
 */

/**
 * Provider models mapping type
 * This is derived from the JSON data and provides type-safe access
 */
export type ProviderModelsMap = {
${Object.entries(n).map(([e,t])=>{let r=t.map(e=>`'${e}'`),i=/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(e)?e:`'${e}'`,a=`  readonly ${i}: readonly [${r.join(", ")}];`;return a.length>120?`  readonly ${i}: readonly [
${t.map(e=>`    '${e}',`).join("\n")}
  ];`:a}).join("\n")}
};

/**
 * Union type of all registered provider IDs
 */
export type Provider = keyof ProviderModelsMap;

/**
 * Provider models mapping interface
 */
export interface ProviderModels {
  [key: string]: string[];
}

/**
 * OpenAI-compatible model ID type
 * Dynamically derived from ProviderModelsMap
 * Full provider/model paths (e.g., "openai/gpt-4o", "anthropic/claude-3-5-sonnet-20241022")
 */
export type ModelRouterModelId =
  | {
      [P in Provider]: \`\${P}/\${ProviderModelsMap[P][number]}\`;
    }[Provider]
  | \`mastra/\${ProviderModelsMap['openrouter'][number]}\`
  | (string & {});

/**
 * Extract the model part from a ModelRouterModelId for a specific provider
 * Dynamically derived from ProviderModelsMap
 * Example: ModelForProvider<'openai'> = 'gpt-4o' | 'gpt-4-turbo' | ...
 */
export type ModelForProvider<P extends Provider> = ProviderModelsMap[P][number];
`,"utf-8");let f=r.default.join(u,"capabilities"),m=d&&Object.keys(d).length>0||l&&Object.keys(l).length>0||c&&Object.keys(c).length>0;if(await i.default.rm(f,{recursive:!0,force:!0}),m)for(let e of(await i.default.mkdir(f,{recursive:!0}),new Set([...d?Object.keys(d):[],...l?Object.keys(l):[],...c?Object.keys(c):[]]))){let i={};d?.[e]&&(i.attachment=d[e]),l?.[e]&&(i.temperature=l[e]),c?.[e]&&(i.structuredOutput=c[e]),await o(r.default.join(f,(0,t.a)(e)),JSON.stringify(i,null,2),"utf-8")}}e.s(["fetchProvidersFromGateways",0,s,"writeRegistryFiles",0,n])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0whoyqo._.js.map