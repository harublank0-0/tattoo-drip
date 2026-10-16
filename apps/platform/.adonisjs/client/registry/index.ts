/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'drive.public.serve': {
    methods: ["GET","HEAD"],
    pattern: '/uploads/*',
    tokens: [{"old":"/uploads/*","type":0,"val":"uploads","end":""},{"old":"/uploads/*","type":2,"val":"*","end":""}],
    types: placeholder as Registry['drive.public.serve']['types'],
  },
  'drive.private.serve': {
    methods: ["GET","HEAD"],
    pattern: '/files/*',
    tokens: [{"old":"/files/*","type":0,"val":"files","end":""},{"old":"/files/*","type":2,"val":"*","end":""}],
    types: placeholder as Registry['drive.private.serve']['types'],
  },
  'home': {
    methods: ["GET","HEAD"],
    pattern: '/',
    tokens: [{"old":"/","type":0,"val":"/","end":""}],
    types: placeholder as Registry['home']['types'],
  },
  'new_account.create': {
    methods: ["GET","HEAD"],
    pattern: '/signup',
    tokens: [{"old":"/signup","type":0,"val":"signup","end":""}],
    types: placeholder as Registry['new_account.create']['types'],
  },
  'new_account.store': {
    methods: ["POST"],
    pattern: '/signup',
    tokens: [{"old":"/signup","type":0,"val":"signup","end":""}],
    types: placeholder as Registry['new_account.store']['types'],
  },
  'session.create': {
    methods: ["GET","HEAD"],
    pattern: '/login',
    tokens: [{"old":"/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['session.create']['types'],
  },
  'session.store': {
    methods: ["POST"],
    pattern: '/login',
    tokens: [{"old":"/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['session.store']['types'],
  },
  'tenant.dashboard': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant',
    tokens: [{"old":"/t/:tenant","type":0,"val":"t","end":""},{"old":"/t/:tenant","type":1,"val":"tenant","end":""}],
    types: placeholder as Registry['tenant.dashboard']['types'],
  },
  'tenant.settings': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/settings',
    tokens: [{"old":"/t/:tenant/settings","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings","type":0,"val":"settings","end":""}],
    types: placeholder as Registry['tenant.settings']['types'],
  },
  'tenant.settings.profile': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/settings/profile',
    tokens: [{"old":"/t/:tenant/settings/profile","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/profile","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/profile","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['tenant.settings.profile']['types'],
  },
  'tenant.settings.profile.update': {
    methods: ["PUT"],
    pattern: '/t/:tenant/settings/profile',
    tokens: [{"old":"/t/:tenant/settings/profile","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/profile","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/profile","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/profile","type":0,"val":"profile","end":""}],
    types: placeholder as Registry['tenant.settings.profile.update']['types'],
  },
  'tenant.settings.payments': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/settings/payments',
    tokens: [{"old":"/t/:tenant/settings/payments","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/payments","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/payments","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/payments","type":0,"val":"payments","end":""}],
    types: placeholder as Registry['tenant.settings.payments']['types'],
  },
  'tenant.settings.deposits.update': {
    methods: ["PUT"],
    pattern: '/t/:tenant/settings/deposits',
    tokens: [{"old":"/t/:tenant/settings/deposits","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/deposits","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/deposits","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/deposits","type":0,"val":"deposits","end":""}],
    types: placeholder as Registry['tenant.settings.deposits.update']['types'],
  },
  'tenant.settings.payments.create': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/settings/payments/new',
    tokens: [{"old":"/t/:tenant/settings/payments/new","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/payments/new","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/payments/new","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/payments/new","type":0,"val":"payments","end":""},{"old":"/t/:tenant/settings/payments/new","type":0,"val":"new","end":""}],
    types: placeholder as Registry['tenant.settings.payments.create']['types'],
  },
  'tenant.settings.payments.store': {
    methods: ["POST"],
    pattern: '/t/:tenant/settings/payments',
    tokens: [{"old":"/t/:tenant/settings/payments","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/payments","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/payments","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/payments","type":0,"val":"payments","end":""}],
    types: placeholder as Registry['tenant.settings.payments.store']['types'],
  },
  'tenant.settings.payments.update': {
    methods: ["PUT"],
    pattern: '/t/:tenant/settings/payments/:id',
    tokens: [{"old":"/t/:tenant/settings/payments/:id","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/payments/:id","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/payments/:id","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/payments/:id","type":0,"val":"payments","end":""},{"old":"/t/:tenant/settings/payments/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['tenant.settings.payments.update']['types'],
  },
  'tenant.settings.payments.edit': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/settings/payments/:id/edit',
    tokens: [{"old":"/t/:tenant/settings/payments/:id/edit","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/payments/:id/edit","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/payments/:id/edit","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/payments/:id/edit","type":0,"val":"payments","end":""},{"old":"/t/:tenant/settings/payments/:id/edit","type":1,"val":"id","end":""},{"old":"/t/:tenant/settings/payments/:id/edit","type":0,"val":"edit","end":""}],
    types: placeholder as Registry['tenant.settings.payments.edit']['types'],
  },
  'tenant.settings.payments.move': {
    methods: ["POST"],
    pattern: '/t/:tenant/settings/payments/:id/move',
    tokens: [{"old":"/t/:tenant/settings/payments/:id/move","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/payments/:id/move","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/payments/:id/move","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/payments/:id/move","type":0,"val":"payments","end":""},{"old":"/t/:tenant/settings/payments/:id/move","type":1,"val":"id","end":""},{"old":"/t/:tenant/settings/payments/:id/move","type":0,"val":"move","end":""}],
    types: placeholder as Registry['tenant.settings.payments.move']['types'],
  },
  'tenant.settings.payments.destroy': {
    methods: ["DELETE"],
    pattern: '/t/:tenant/settings/payments/:id',
    tokens: [{"old":"/t/:tenant/settings/payments/:id","type":0,"val":"t","end":""},{"old":"/t/:tenant/settings/payments/:id","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/settings/payments/:id","type":0,"val":"settings","end":""},{"old":"/t/:tenant/settings/payments/:id","type":0,"val":"payments","end":""},{"old":"/t/:tenant/settings/payments/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['tenant.settings.payments.destroy']['types'],
  },
  'tenant.artists': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/artists',
    tokens: [{"old":"/t/:tenant/artists","type":0,"val":"t","end":""},{"old":"/t/:tenant/artists","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/artists","type":0,"val":"artists","end":""}],
    types: placeholder as Registry['tenant.artists']['types'],
  },
  'tenant.artists.create': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/artists/new',
    tokens: [{"old":"/t/:tenant/artists/new","type":0,"val":"t","end":""},{"old":"/t/:tenant/artists/new","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/artists/new","type":0,"val":"artists","end":""},{"old":"/t/:tenant/artists/new","type":0,"val":"new","end":""}],
    types: placeholder as Registry['tenant.artists.create']['types'],
  },
  'tenant.artists.store': {
    methods: ["POST"],
    pattern: '/t/:tenant/artists',
    tokens: [{"old":"/t/:tenant/artists","type":0,"val":"t","end":""},{"old":"/t/:tenant/artists","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/artists","type":0,"val":"artists","end":""}],
    types: placeholder as Registry['tenant.artists.store']['types'],
  },
  'tenant.artists.edit': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/artists/:id/edit',
    tokens: [{"old":"/t/:tenant/artists/:id/edit","type":0,"val":"t","end":""},{"old":"/t/:tenant/artists/:id/edit","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/artists/:id/edit","type":0,"val":"artists","end":""},{"old":"/t/:tenant/artists/:id/edit","type":1,"val":"id","end":""},{"old":"/t/:tenant/artists/:id/edit","type":0,"val":"edit","end":""}],
    types: placeholder as Registry['tenant.artists.edit']['types'],
  },
  'tenant.artists.update': {
    methods: ["PUT"],
    pattern: '/t/:tenant/artists/:id',
    tokens: [{"old":"/t/:tenant/artists/:id","type":0,"val":"t","end":""},{"old":"/t/:tenant/artists/:id","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/artists/:id","type":0,"val":"artists","end":""},{"old":"/t/:tenant/artists/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['tenant.artists.update']['types'],
  },
  'tenant.artists.destroy': {
    methods: ["DELETE"],
    pattern: '/t/:tenant/artists/:id',
    tokens: [{"old":"/t/:tenant/artists/:id","type":0,"val":"t","end":""},{"old":"/t/:tenant/artists/:id","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/artists/:id","type":0,"val":"artists","end":""},{"old":"/t/:tenant/artists/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['tenant.artists.destroy']['types'],
  },
  'tenant.inbox.index': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/inbox',
    tokens: [{"old":"/t/:tenant/inbox","type":0,"val":"t","end":""},{"old":"/t/:tenant/inbox","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/inbox","type":0,"val":"inbox","end":""}],
    types: placeholder as Registry['tenant.inbox.index']['types'],
  },
  'tenant.inbox.show': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/inbox/:id',
    tokens: [{"old":"/t/:tenant/inbox/:id","type":0,"val":"t","end":""},{"old":"/t/:tenant/inbox/:id","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/inbox/:id","type":0,"val":"inbox","end":""},{"old":"/t/:tenant/inbox/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['tenant.inbox.show']['types'],
  },
  'tenant.inbox.accept': {
    methods: ["POST"],
    pattern: '/t/:tenant/inbox/:id/accept',
    tokens: [{"old":"/t/:tenant/inbox/:id/accept","type":0,"val":"t","end":""},{"old":"/t/:tenant/inbox/:id/accept","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/inbox/:id/accept","type":0,"val":"inbox","end":""},{"old":"/t/:tenant/inbox/:id/accept","type":1,"val":"id","end":""},{"old":"/t/:tenant/inbox/:id/accept","type":0,"val":"accept","end":""}],
    types: placeholder as Registry['tenant.inbox.accept']['types'],
  },
  'tenant.inbox.decline': {
    methods: ["POST"],
    pattern: '/t/:tenant/inbox/:id/decline',
    tokens: [{"old":"/t/:tenant/inbox/:id/decline","type":0,"val":"t","end":""},{"old":"/t/:tenant/inbox/:id/decline","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/inbox/:id/decline","type":0,"val":"inbox","end":""},{"old":"/t/:tenant/inbox/:id/decline","type":1,"val":"id","end":""},{"old":"/t/:tenant/inbox/:id/decline","type":0,"val":"decline","end":""}],
    types: placeholder as Registry['tenant.inbox.decline']['types'],
  },
  'tenant.projects.index': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/projects',
    tokens: [{"old":"/t/:tenant/projects","type":0,"val":"t","end":""},{"old":"/t/:tenant/projects","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/projects","type":0,"val":"projects","end":""}],
    types: placeholder as Registry['tenant.projects.index']['types'],
  },
  'tenant.projects.show': {
    methods: ["GET","HEAD"],
    pattern: '/t/:tenant/projects/:id',
    tokens: [{"old":"/t/:tenant/projects/:id","type":0,"val":"t","end":""},{"old":"/t/:tenant/projects/:id","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/projects/:id","type":0,"val":"projects","end":""},{"old":"/t/:tenant/projects/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['tenant.projects.show']['types'],
  },
  'tenant.projects.quotes.store': {
    methods: ["POST"],
    pattern: '/t/:tenant/projects/:id/quotes',
    tokens: [{"old":"/t/:tenant/projects/:id/quotes","type":0,"val":"t","end":""},{"old":"/t/:tenant/projects/:id/quotes","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/projects/:id/quotes","type":0,"val":"projects","end":""},{"old":"/t/:tenant/projects/:id/quotes","type":1,"val":"id","end":""},{"old":"/t/:tenant/projects/:id/quotes","type":0,"val":"quotes","end":""}],
    types: placeholder as Registry['tenant.projects.quotes.store']['types'],
  },
  'tenant.projects.quotes.accept': {
    methods: ["POST"],
    pattern: '/t/:tenant/projects/:id/quotes/accept',
    tokens: [{"old":"/t/:tenant/projects/:id/quotes/accept","type":0,"val":"t","end":""},{"old":"/t/:tenant/projects/:id/quotes/accept","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/projects/:id/quotes/accept","type":0,"val":"projects","end":""},{"old":"/t/:tenant/projects/:id/quotes/accept","type":1,"val":"id","end":""},{"old":"/t/:tenant/projects/:id/quotes/accept","type":0,"val":"quotes","end":""},{"old":"/t/:tenant/projects/:id/quotes/accept","type":0,"val":"accept","end":""}],
    types: placeholder as Registry['tenant.projects.quotes.accept']['types'],
  },
  'tenant.projects.moves.store': {
    methods: ["POST"],
    pattern: '/t/:tenant/projects/:id/moves',
    tokens: [{"old":"/t/:tenant/projects/:id/moves","type":0,"val":"t","end":""},{"old":"/t/:tenant/projects/:id/moves","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/projects/:id/moves","type":0,"val":"projects","end":""},{"old":"/t/:tenant/projects/:id/moves","type":1,"val":"id","end":""},{"old":"/t/:tenant/projects/:id/moves","type":0,"val":"moves","end":""}],
    types: placeholder as Registry['tenant.projects.moves.store']['types'],
  },
  'tenant.projects.notes.update': {
    methods: ["PUT"],
    pattern: '/t/:tenant/projects/:id/notes',
    tokens: [{"old":"/t/:tenant/projects/:id/notes","type":0,"val":"t","end":""},{"old":"/t/:tenant/projects/:id/notes","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/projects/:id/notes","type":0,"val":"projects","end":""},{"old":"/t/:tenant/projects/:id/notes","type":1,"val":"id","end":""},{"old":"/t/:tenant/projects/:id/notes","type":0,"val":"notes","end":""}],
    types: placeholder as Registry['tenant.projects.notes.update']['types'],
  },
  'tenant.projects.contacted.store': {
    methods: ["POST"],
    pattern: '/t/:tenant/projects/:id/contacted',
    tokens: [{"old":"/t/:tenant/projects/:id/contacted","type":0,"val":"t","end":""},{"old":"/t/:tenant/projects/:id/contacted","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/projects/:id/contacted","type":0,"val":"projects","end":""},{"old":"/t/:tenant/projects/:id/contacted","type":1,"val":"id","end":""},{"old":"/t/:tenant/projects/:id/contacted","type":0,"val":"contacted","end":""}],
    types: placeholder as Registry['tenant.projects.contacted.store']['types'],
  },
  'tenant.projects.artist.update': {
    methods: ["PUT"],
    pattern: '/t/:tenant/projects/:id/artist',
    tokens: [{"old":"/t/:tenant/projects/:id/artist","type":0,"val":"t","end":""},{"old":"/t/:tenant/projects/:id/artist","type":1,"val":"tenant","end":""},{"old":"/t/:tenant/projects/:id/artist","type":0,"val":"projects","end":""},{"old":"/t/:tenant/projects/:id/artist","type":1,"val":"id","end":""},{"old":"/t/:tenant/projects/:id/artist","type":0,"val":"artist","end":""}],
    types: placeholder as Registry['tenant.projects.artist.update']['types'],
  },
  'dashboard': {
    methods: ["GET","HEAD"],
    pattern: '/dashboard',
    tokens: [{"old":"/dashboard","type":0,"val":"dashboard","end":""}],
    types: placeholder as Registry['dashboard']['types'],
  },
  'session.destroy': {
    methods: ["POST"],
    pattern: '/logout',
    tokens: [{"old":"/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['session.destroy']['types'],
  },
  'onboarding.create': {
    methods: ["GET","HEAD"],
    pattern: '/onboarding',
    tokens: [{"old":"/onboarding","type":0,"val":"onboarding","end":""}],
    types: placeholder as Registry['onboarding.create']['types'],
  },
  'onboarding.store': {
    methods: ["POST"],
    pattern: '/onboarding',
    tokens: [{"old":"/onboarding","type":0,"val":"onboarding","end":""}],
    types: placeholder as Registry['onboarding.store']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
