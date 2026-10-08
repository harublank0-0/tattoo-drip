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
    'tenant.settings': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.profile': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.profile.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.deposits.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.settings.payments.move': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.settings.payments.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
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
    'tenant.settings': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.profile': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
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
    'tenant.settings': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.profile': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'onboarding.create': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'tenant.settings.payments.move': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'onboarding.store': { paramsTuple?: []; params?: {} }
  }
  PUT: {
    'tenant.settings.profile.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.deposits.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
  }
  DELETE: {
    'tenant.settings.payments.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}