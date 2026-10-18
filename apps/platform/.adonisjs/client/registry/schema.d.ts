/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'drive.public.serve': {
    methods: ["GET","HEAD"]
    pattern: '/uploads/*'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { '*': ParamValue[] }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'drive.private.serve': {
    methods: ["GET","HEAD"]
    pattern: '/files/*'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { '*': ParamValue[] }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'home': {
    methods: ["GET","HEAD"]
    pattern: '/'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'new_account.create': {
    methods: ["GET","HEAD"]
    pattern: '/signup'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['create']>>>
    }
  }
  'new_account.store': {
    methods: ["POST"]
    pattern: '/signup'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').signupValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').signupValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'session.create': {
    methods: ["GET","HEAD"]
    pattern: '/login'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['create']>>>
    }
  }
  'session.store': {
    methods: ["POST"]
    pattern: '/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.dashboard': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['tenantHome']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['tenantHome']>>>
    }
  }
  'tenant.settings': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/settings'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'tenant.settings.profile': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/settings/profile'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/studio_profile_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/studio_profile_controller').default['show']>>>
    }
  }
  'tenant.settings.profile.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/profile'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/tenant').updateProfileValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/tenant').updateProfileValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/studio_profile_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/studio_profile_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.slug.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/slug'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/tenant').changeSlugValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/tenant').changeSlugValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/studio_slug_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/studio_slug_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.payments': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/settings/payments'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['index']>>>
    }
  }
  'tenant.settings.deposits.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/deposits'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/tenant').updateDepositSettingsValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/tenant').updateDepositSettingsValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/deposit_settings_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/deposit_settings_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.payments.create': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/settings/payments/new'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['create']>>>
    }
  }
  'tenant.settings.payments.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/settings/payments'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/payment_method').createPaymentMethodValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/payment_method').createPaymentMethodValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.payments.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/payments/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/payment_method').updatePaymentMethodValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/payment_method').updatePaymentMethodValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.payments.edit': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/settings/payments/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['edit']>>>
    }
  }
  'tenant.settings.payments.move': {
    methods: ["POST"]
    pattern: '/t/:tenant/settings/payments/:id/move'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/payment_method').movePaymentMethodValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/payment_method').movePaymentMethodValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['move']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['move']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.payments.destroy': {
    methods: ["DELETE"]
    pattern: '/t/:tenant/settings/payments/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payment_methods_controller').default['destroy']>>>
    }
  }
  'tenant.settings.messages': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/settings/messages'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/message_templates_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/message_templates_controller').default['show']>>>
    }
  }
  'tenant.settings.messages.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/messages'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/notifications/validators/message_templates').messageTemplatesValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/notifications/validators/message_templates').messageTemplatesValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/message_templates_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/message_templates_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.artists': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/artists'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['index']>>>
    }
  }
  'tenant.artists.create': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/artists/new'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['create']>>>
    }
  }
  'tenant.artists.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/artists'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/artists/validators/artist').createArtistValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/artists/validators/artist').createArtistValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.artists.edit': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/artists/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['edit']>>>
    }
  }
  'tenant.artists.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/artists/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/artists/validators/artist').updateArtistValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/artists/validators/artist').updateArtistValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.artists.destroy': {
    methods: ["DELETE"]
    pattern: '/t/:tenant/artists/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['destroy']>>>
    }
  }
  'tenant.inbox.index': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/inbox'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['index']>>>
    }
  }
  'tenant.inbox.show': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/inbox/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['show']>>>
    }
  }
  'tenant.inbox.accept': {
    methods: ["POST"]
    pattern: '/t/:tenant/inbox/:id/accept'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/inquiries/validators/inquiry').acceptInquiryValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/inquiries/validators/inquiry').acceptInquiryValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['accept']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.inbox.decline': {
    methods: ["POST"]
    pattern: '/t/:tenant/inbox/:id/decline'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['decline']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['decline']>>>
    }
  }
  'tenant.clients.index': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/clients'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/clients_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/clients_controller').default['index']>>>
    }
  }
  'tenant.clients.show': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/clients/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/clients_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/clients_controller').default['show']>>>
    }
  }
  'tenant.clients.edit': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/clients/:id/edit'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/clients_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/clients_controller').default['edit']>>>
    }
  }
  'tenant.clients.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/clients/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/clients/validators/client').updateClientValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/clients/validators/client').updateClientValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/clients_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/clients_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.create': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/projects/new'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/bookings_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/bookings_controller').default['create']>>>
    }
  }
  'tenant.projects.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/projects/validators/booking').bookingValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/projects/validators/booking').bookingValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/bookings_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/bookings_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.index': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/projects'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['index']>>>
    }
  }
  'tenant.projects.show': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/projects/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/projects_controller').default['show']>>>
    }
  }
  'tenant.projects.quotes.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/quotes'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/projects/validators/quote').quoteValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/projects/validators/quote').quoteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.quotes.accept': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/quotes/accept'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/projects/validators/quote').acceptQuoteValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/projects/validators/quote').acceptQuoteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['accept']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.price.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/price'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/projects/validators/quote').priceValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/projects/validators/quote').priceValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['price']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/quotes_controller').default['price']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.moves.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/moves'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/projects/validators/project').moveValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/projects/validators/project').moveValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['move']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['move']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.notes.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/projects/:id/notes'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/projects/validators/project').notesValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/projects/validators/project').notesValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['notes']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['notes']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.contacted.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/contacted'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['contacted']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['contacted']>>>
    }
  }
  'tenant.projects.artist.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/projects/:id/artist'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/projects/validators/project').artistValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/projects/validators/project').artistValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['artist']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['artist']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.sessions.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/sessions'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/scheduling/validators/session').scheduleValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/scheduling/validators/session').scheduleValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_sessions_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_sessions_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.deposit_link.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/deposit-link'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/deposit_links_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/deposit_links_controller').default['store']>>>
    }
  }
  'tenant.projects.payments.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/payments'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/payment').deskPaymentValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/payment').deskPaymentValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.refunds.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/refunds'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/payment').refundValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/payment').refundValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['refund']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['refund']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.projects.deposit_outcome.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/deposit-outcome'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/payment').outcomeValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/payment').outcomeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['outcome']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['outcome']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.payments.verify': {
    methods: ["POST"]
    pattern: '/t/:tenant/payments/:id/verify'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/payment').decisionValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/payment').decisionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['verify']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['verify']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.payments.reject': {
    methods: ["POST"]
    pattern: '/t/:tenant/payments/:id/reject'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/payment').decisionValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/payment').decisionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['reject']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['reject']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.payments.reverse': {
    methods: ["POST"]
    pattern: '/t/:tenant/payments/:id/reverse'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/payment').decisionValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/payment').decisionValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['reverse']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/payments_controller').default['reverse']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.sessions.outcome': {
    methods: ["POST"]
    pattern: '/t/:tenant/sessions/:id/outcome'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/scheduling/validators/session').outcomeValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/scheduling/validators/session').outcomeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_sessions_controller').default['outcome']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_sessions_controller').default['outcome']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.sessions.move': {
    methods: ["POST"]
    pattern: '/t/:tenant/sessions/:id/move'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/scheduling/validators/session').sessionTimeValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/scheduling/validators/session').sessionTimeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_sessions_controller').default['move']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_sessions_controller').default['move']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.calendar.index': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/calendar'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/calendar_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/calendar_controller').default['index']>>>
    }
  }
  'dashboard': {
    methods: ["GET","HEAD"]
    pattern: '/dashboard'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['show']>>>
    }
  }
  'session.destroy': {
    methods: ["POST"]
    pattern: '/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/session_controller').default['destroy']>>>
    }
  }
  'onboarding.create': {
    methods: ["GET","HEAD"]
    pattern: '/onboarding'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/onboarding_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/onboarding_controller').default['create']>>>
    }
  }
  'onboarding.store': {
    methods: ["POST"]
    pattern: '/onboarding'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/tenant').createTenantValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/tenant').createTenantValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/onboarding_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/onboarding_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'api.v1.studio': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/tenants/:tenant'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_studio_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_studio_controller').default['show']>>>
    }
  }
  'api.v1.artists.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/tenants/:tenant/artists'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_artists_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_artists_controller').default['index']>>>
    }
  }
  'api.v1.artists.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/tenants/:tenant/artists/:artist'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; artist: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_artists_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_artists_controller').default['show']>>>
    }
  }
  'api.v1.inquiries.store': {
    methods: ["POST"]
    pattern: '/api/v1/tenants/:tenant/inquiries'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/inquiries/validators/intake').intakeValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/inquiries/validators/intake').intakeValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_inquiries_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_inquiries_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'api.v1.deposits.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/tenants/:tenant/deposits/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_deposits_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_deposits_controller').default['show']>>>
    }
  }
  'api.v1.deposits.store': {
    methods: ["POST"]
    pattern: '/api/v1/tenants/:tenant/deposits/:token'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/payments/validators/deposit_proof').depositProofValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; token: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/payments/validators/deposit_proof').depositProofValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_deposits_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_deposits_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
}
