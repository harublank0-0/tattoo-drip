import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'drive.public.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'drive.private.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'home': { paramsTuple?: []; params?: {} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'tenant.dashboard': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'onboarding.create': { paramsTuple?: []; params?: {} }
    'onboarding.store': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'drive.public.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'drive.private.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'home': { paramsTuple?: []; params?: {} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'tenant.dashboard': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'onboarding.create': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'drive.public.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'drive.private.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'home': { paramsTuple?: []; params?: {} }
    'new_account.create': { paramsTuple?: []; params?: {} }
    'session.create': { paramsTuple?: []; params?: {} }
    'tenant.dashboard': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'onboarding.create': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'onboarding.store': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}