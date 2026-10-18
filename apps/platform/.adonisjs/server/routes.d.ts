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
    'tenant.settings.slug.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.deposits.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.store': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.settings.payments.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.settings.payments.move': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.settings.payments.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.settings.messages': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.messages.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists.store': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.artists.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.artists.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.inbox.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.inbox.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.inbox.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.inbox.decline': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.inbox.contacted.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.clients.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.clients.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.clients.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.clients.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.projects.store': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.projects.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.projects.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.quotes.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.quotes.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.price.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.moves.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.notes.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.contacted.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.artist.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.sessions.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.deposit_link.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.payments.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.refunds.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.deposit_outcome.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.payments.verify': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.payments.reject': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.payments.reverse': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.sessions.outcome': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.sessions.move': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.calendar.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'onboarding.create': { paramsTuple?: []; params?: {} }
    'onboarding.store': { paramsTuple?: []; params?: {} }
    'api.v1.studio': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'api.v1.artists.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'api.v1.artists.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'artist': ParamValue} }
    'api.v1.inquiries.store': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'api.v1.deposits.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'token': ParamValue} }
    'api.v1.deposits.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'token': ParamValue} }
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
    'tenant.settings.messages': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.inbox.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.inbox.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.clients.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.clients.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.clients.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.projects.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.projects.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.calendar.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'onboarding.create': { paramsTuple?: []; params?: {} }
    'api.v1.studio': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'api.v1.artists.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'api.v1.artists.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'artist': ParamValue} }
    'api.v1.deposits.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'token': ParamValue} }
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
    'tenant.settings.messages': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.inbox.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.inbox.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.clients.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.clients.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.clients.edit': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.create': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.projects.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.projects.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.calendar.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'dashboard': { paramsTuple?: []; params?: {} }
    'onboarding.create': { paramsTuple?: []; params?: {} }
    'api.v1.studio': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'api.v1.artists.index': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'api.v1.artists.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'artist': ParamValue} }
    'api.v1.deposits.show': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'token': ParamValue} }
  }
  POST: {
    'new_account.store': { paramsTuple?: []; params?: {} }
    'session.store': { paramsTuple?: []; params?: {} }
    'tenant.settings.payments.store': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.move': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.artists.store': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.inbox.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.inbox.decline': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.inbox.contacted.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.store': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.projects.quotes.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.quotes.accept': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.price.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.moves.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.contacted.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.sessions.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.deposit_link.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.payments.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.refunds.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.deposit_outcome.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.payments.verify': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.payments.reject': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.payments.reverse': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.sessions.outcome': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.sessions.move': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'session.destroy': { paramsTuple?: []; params?: {} }
    'onboarding.store': { paramsTuple?: []; params?: {} }
    'api.v1.inquiries.store': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'api.v1.deposits.store': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'token': ParamValue} }
  }
  PUT: {
    'tenant.settings.profile.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.slug.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.deposits.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.settings.payments.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.settings.messages.update': { paramsTuple: [ParamValue]; params: {'tenant': ParamValue} }
    'tenant.artists.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.clients.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.notes.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.projects.artist.update': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
  }
  DELETE: {
    'tenant.settings.payments.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
    'tenant.artists.destroy': { paramsTuple: [ParamValue,ParamValue]; params: {'tenant': ParamValue,'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}