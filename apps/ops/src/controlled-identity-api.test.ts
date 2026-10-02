import { describe, expect, it, vi } from "vitest";
import { createControlledIdentityClient } from "./controlled-identity-api.js";
const actor = { id: "actor-test", personId: "person-test", role: "OPS", userId: null, restaurantId: null, version: 1 };
const envelope = (principal: unknown = actor) => ({ version: "v11-identity-1", principal });
function setup() {
  const send = vi.fn(async (path: string, _options: RequestInit): Promise<{status:number;data:unknown}> => ({status:200,data:{...envelope(),...(path.endsWith("login")?{token:"synthetic-session"}:{})}}));
  return { send, client: createControlledIdentityClient(send) };
}
describe("formal controlled identity client", () => {
  it("verifies identity before accepting login and exposes no session token", async () => {
    const {send,client}=setup();expect(await client.login("ops-test","synthetic-password")).toEqual(actor);
    expect(send.mock.calls.map(x=>x[0])).toEqual(["/api/v11/ops/login","/api/v11/ops/identity"]);
    expect(client.current()).toEqual(actor);expect(client.current()).not.toHaveProperty("token");
    client.current()!.role="REVIEWER";expect(client.current()!.role).toBe("OPS");
  });
  it.each([
    {...actor,role:"USER"}, {...actor,userId:"user-test"}, {...actor,restaurantId:"restaurant-test"},
    {...actor,role:"RESTAURANT",restaurantId:null}, {...actor,version:-1}, {...actor,version:1.5},
  ])("rejects malformed or elevated identity %j", async invalid => {
    const {send,client}=setup();send.mockResolvedValue({status:200,data:{...envelope(invalid),token:"synthetic-session"}});
    await expect(client.login("ops-test","synthetic-password")).rejects.toThrow();expect(client.current()).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects changed binding during login",async()=>{
    const {send,client}=setup();send.mockResolvedValueOnce({status:200,data:{...envelope(),token:"synthetic-session"}})
      .mockResolvedValueOnce({status:200,data:envelope({...actor,version:2})});
    await expect(client.login("ops-test","synthetic-password")).rejects.toThrow("身份绑定已变更");expect(client.current()).toBeNull();
  });
  it("discards pending login after logout",async()=>{
    const {send,client}=setup();let resolve!:(value:{status:number;data:unknown})=>void;
    send.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=client.login("ops-test","synthetic-password");
    client.logout();resolve({status:200,data:{...envelope(),token:"synthetic-session"}});
    await expect(pending).rejects.toThrow("已取消");expect(client.current()).toBeNull();expect(send).toHaveBeenCalledTimes(1);
  });
  it("clears failed current verification without retry",async()=>{
    const {send,client}=setup();await client.login("ops-test","synthetic-password");send.mockResolvedValueOnce({status:401,data:null});
    await expect(client.refresh()).rejects.toThrow("失效");expect(client.current()).toBeNull();expect(send).toHaveBeenCalledTimes(3);
  });
  it("preserves a new login when an old verification returns 401",async()=>{
    const {send,client}=setup();await client.login("ops-test","synthetic-password");let resolve!:(value:{status:number;data:unknown})=>void;
    send.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=client.refresh();
    await client.login("ops-test","synthetic-password");resolve({status:401,data:null});
    await expect(pending).rejects.toThrow();expect(client.current()).toEqual(actor);
  });
  it("projects away credential-bearing extras",async()=>{
    const {send,client}=setup();send.mockResolvedValue({status:200,data:{...envelope({...actor,passwordHash:"never-project"} as typeof actor),token:"synthetic-session"}});
    expect(await client.login("ops-test","synthetic-password")).toEqual(actor);
  });
});

it('fences controlled funds after logout and projects away extras',async()=>{
 const send=vi.fn(async(path:string):Promise<{status:number;data:unknown}>=>({status:200,data:path.endsWith('capabilities')?{version:'v11-identity-1',controlledObligationsEnabled:true}:{...envelope(),...(path.endsWith('login')?{token:'synthetic-session'}:{})}}));const client=createControlledIdentityClient(send);await client.login('ops','synthetic-password');
 const page={version:'v11-controlled-obligations-1',scope:'BOUND_RECORDED_OBLIGATIONS_ONLY',coverage:'RECORDED_ONLY',releaseAuthorized:false,nextCursor:null,items:[{caseId:'case-test',evidenceConflict:false,dispatchAuthorized:false,obligation:{amountCents:100,confirmedCents:0,remainingCents:100,state:'AWAITING_EXECUTION',secret:'synthetic-extra'}}]};
 send.mockResolvedValueOnce({status:200,data:{version:'v11-identity-1',controlledObligationsEnabled:true}}).mockResolvedValueOnce({status:200,data:page});expect(JSON.stringify(await client.obligations())).not.toContain('synthetic-extra');
 let resolve!:(v:{status:number;data:unknown})=>void;send.mockResolvedValueOnce({status:200,data:{version:'v11-identity-1',controlledObligationsEnabled:true}}).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const pending=client.obligations();await Promise.resolve();await Promise.resolve();client.logout();resolve({status:200,data:page});await expect(pending).rejects.toThrow('取消');expect(client.current()).toBeNull();
});

it('allows responsibility next-page cursor and preserves method/query constraints',async()=>{const {send,client}=setup();await client.login('ops','synthetic-password');const path='/api/v11/formal/responsibility-cancellations?cursor=request%3Anext';await client.business(path);expect(send.mock.calls.at(-1)?.[0]).toBe(path);const count=send.mock.calls.length;await expect(client.business(path,'POST')).rejects.toThrow('业务页码无效');await expect(client.business('/api/v11/formal/responsibility-cancellations?cursor=request&role=OPS')).rejects.toThrow('业务页码无效');expect(send).toHaveBeenCalledTimes(count);});
