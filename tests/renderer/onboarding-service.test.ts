import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlazaUser } from '../../src/shared/contracts/plaza'
import { savePlazaSession, loadPlazaSession, clearPlazaSession } from '../../src/renderer/src/services/plaza-session'
import * as guide from '../../src/renderer/src/services/onboarding-service'
const mocks=vi.hoisted(()=>({view:'lobby',navigate:vi.fn(),persist:vi.fn(),navListener:undefined as undefined|(()=>void)}))
vi.mock('../../src/renderer/src/app-nav',()=>({getAppView:()=>mocks.view,openLobby:()=>{mocks.view='lobby'},subscribeAppNav:(fn:()=>void)=>{mocks.navListener=fn;return ()=>{mocks.navListener=undefined}}}))
vi.mock('../../src/renderer/src/services/onboarding-nav',()=>({navigateForOnboardingStep:mocks.navigate}))
vi.mock('../../src/renderer/src/services/plaza-api',()=>({completePlazaOnboarding:mocks.persist}))
const user:PlazaUser={userId:'kid-a',username:'小画家',role:'child',onboardingCompletedVersion:0}
function login(who:PlazaUser=user){savePlazaSession({token:'token-'+who.userId,user:who})}
beforeEach(()=>{
  const items=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>items.get(k)??null,setItem:(k:string,v:string)=>items.set(k,v),removeItem:(k:string)=>items.delete(k)})
  vi.useFakeTimers();guide.stopOnboardingUi();vi.clearAllMocks();mocks.view='lobby'
  mocks.persist.mockResolvedValue({...user,onboardingCompletedVersion:1});login()
})
afterEach(()=>{guide.stopOnboardingUi();vi.useRealTimers();vi.unstubAllGlobals()})
describe('account-scoped first-login tour',()=>{
  it('starts only an explicitly new account after auth navigation, not a completed or legacy account',async()=>{
    for(const who of [{...user,onboardingCompletedVersion:1},{...user,onboardingCompletedVersion:undefined}]){
      login(who);guide.maybeStartOnboardingAfterAuth(who);await vi.advanceTimersByTimeAsync(400);expect(guide.isOnboardingActive()).toBe(false)
    }
    login();guide.maybeStartOnboardingAfterAuth(user);await vi.advanceTimersByTimeAsync(400)
    expect(guide.getOnboardingStep()?.id).toBe('lobby-create');expect(guide.isOnboardingActive()).toBe(true)
  })
  it('does not activate a delayed tour after logout, navigation or account switching',async()=>{
    for(const cancel of [()=>clearPlazaSession(),()=>{mocks.view='profile'},()=>login({...user,userId:'other'})]){
      mocks.view='lobby';login();guide.maybeStartOnboardingAfterAuth(user);cancel();await vi.advanceTimersByTimeAsync(400);expect(guide.isOnboardingActive()).toBe(false)
    }
  })
  it('advances copy, auto-navigation and role-aware progress through all current steps',async()=>{
    guide.replayOnboardingTour();expect(guide.getOnboardingProgress()).toBe('1 / 12')
    const ids=[]
    for(let i=0;i<12;i++){ids.push(guide.getOnboardingStep()?.id);guide.advanceOnboardingStep()}
    await Promise.resolve();expect(new Set(ids).size).toBe(12);expect(ids).toContain('editor-material');expect(ids).not.toContain('fabrication-start')
    expect(guide.isOnboardingActive()).toBe(false);expect(mocks.persist).toHaveBeenCalledWith('token-kid-a',1)
  })
  it('skips child-only bear steps for other roles',()=>{
    login({...user,role:'parent'});guide.replayOnboardingTour();expect(guide.getOnboardingProgress()).toBe('1 / 11')
    const ids=[];for(let i=0;i<11;i++){ids.push(guide.getOnboardingStep()?.id);guide.advanceOnboardingStep()}
    expect(ids).not.toContain('rewards-bear');expect(guide.isOnboardingActive()).toBe(false)
  })
  it('records skip/completion per account even offline and retries server persistence on next auth',async()=>{
    mocks.persist.mockRejectedValue(new Error('offline'));guide.replayOnboardingTour();await guide.skipOnboardingTour()
    guide.maybeStartOnboardingAfterAuth(user);await vi.advanceTimersByTimeAsync(400);expect(guide.isOnboardingActive()).toBe(false)
    expect(mocks.persist).toHaveBeenCalledTimes(2)
    const other={...user,userId:'kid-b'};login(other);guide.maybeStartOnboardingAfterAuth(other);await vi.advanceTimersByTimeAsync(400);expect(guide.isOnboardingActive()).toBe(true)
  })
  it('never patches a different account when a delayed completion response arrives',async()=>{
    let resolve!:(user:PlazaUser)=>void;mocks.persist.mockImplementation(()=>new Promise<PlazaUser>(r=>{resolve=r}))
    guide.replayOnboardingTour();const pending=guide.finishOnboardingTour();login({...user,userId:'kid-b'});resolve({...user,onboardingCompletedVersion:1});await pending
    expect(loadPlazaSession()?.user.userId).toBe('kid-b');expect(loadPlazaSession()?.user.onboardingCompletedVersion).toBe(0)
  })
  it('stops visible UI when auth is lost and allows explicit replay after completion',()=>{
    const unsubscribe=guide.bindOnboardingNavRefresh();guide.replayOnboardingTour();clearPlazaSession();mocks.navListener!();expect(guide.isOnboardingActive()).toBe(false);unsubscribe()
    login({...user,onboardingCompletedVersion:1});guide.replayOnboardingTour();expect(guide.isOnboardingActive()).toBe(true)
  })
})
