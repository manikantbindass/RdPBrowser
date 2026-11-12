'use strict';
const { defaults,decide,resourceFor }=require('../services/access');
const now=Date.now();
const user={ id:'user-a',organization_id:'org-a',role:'user',is_active:true,is_locked:false,organization_active:true };
const session={ organization_id:'org-a',is_active:true,absolute_expires_at:new Date(now+600000),last_activity:new Date(now),authenticated_at:new Date(now),authentication_method:'password',mfa_verified:false };
const evaluate=(changes={}) => decide({ user,session,device:null,resource:'browser.navigate',policy:defaults,now,...changes });
test.each([
  [{ user:{ ...user,is_active:false } },'IDENTITY_INACTIVE'],
  [{ user:{ ...user,organization_id:'org-b' } },'ORGANIZATION_MISMATCH'],
  [{ session:{ ...session,is_active:false } },'SESSION_REVOKED'],
  [{ session:{ ...session,absolute_expires_at:new Date(now-1) } },'SESSION_ABSOLUTE_EXPIRED'],
  [{ session:{ ...session,last_activity:new Date(now-86400001) } },'SESSION_IDLE_EXPIRED'],
  [{ policy:{ ...defaults,allowedRoles:['admin'] } },'ROLE_DENIED'],
  [{ resource:'admin.manage' },'ADMIN_REQUIRED'],
  [{ resource:'client-invented' },'RESOURCE_UNKNOWN'],
  [{ policy:{ ...defaults,requireMfa:true } },'MFA_REQUIRED'],
  [{ policy:{ ...defaults,requireTrustedDevice:true },device:{ external_id:'identifier-only',user_id:user.id,organization_id:user.organization_id } },'TRUSTED_DEVICE_REQUIRED'],
  [{ device:{ user_id:user.id,organization_id:user.organization_id,trust_state:'quarantined' } },'DEVICE_INVALID'],
  [{ device:{ user_id:'other-user',organization_id:user.organization_id } },'DEVICE_OWNER_MISMATCH'],
])('access rejects an invalid identity/session/device/resource context: %p',(changes,reason) => {
  expect(evaluate(changes)).toMatchObject({ allowed:false,reason });
});
test('only IdP-backed MFA plus fresh key possession and approved posture satisfy strict policy',() => {
  const device={ user_id:user.id,organization_id:user.organization_id,trust_state:'approved',public_key:{},posture_valid_until:new Date(now+100000) };
  const context={ device,policy:{ ...defaults,requireMfa:true,requireTrustedDevice:true },session:{ ...session,authentication_method:'oidc',mfa_verified:true,device_proved_at:new Date(now) } };
  expect(evaluate(context).allowed).toBe(true);
  expect(evaluate({ ...context,session:{ ...context.session,authentication_method:'password' } }).reason).toBe('MFA_REQUIRED');
  expect(evaluate({ ...context,device:{ ...device,posture_valid_until:new Date(now-1) } }).reason).toBe('TRUSTED_DEVICE_REQUIRED');
  expect(evaluate({ ...context,session:{ ...context.session,device_proved_at:new Date(now-900001) } }).reason).toBe('TRUSTED_DEVICE_REQUIRED');
});
test('resource sensitivity is server-selected and policy evaluation is not policy administration',() => {
  expect(resourceFor({ baseUrl:'/api/v1',path:'/admin/users',method:'GET' })).toBe('admin.manage');
  expect(resourceFor({ baseUrl:'/api/v1',path:'/policies/evaluate',method:'POST' })).toBe('browser.navigate');
  expect(resourceFor({ baseUrl:'/api/v1',path:'/devices',method:'GET' })).toBe('session.manage');
});
test('self termination remains available after policy tightening',() => {
  expect(evaluate({ resource:'session.terminate',policy:{ ...defaults,requireMfa:true,requireTrustedDevice:true } }).allowed).toBe(true);
});
