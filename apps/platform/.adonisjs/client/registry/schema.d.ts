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
  'new_account.sent': {
    methods: ["GET","HEAD"]
    pattern: '/signup/sent'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['sent']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/new_account_controller').default['sent']>>>
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
  'password_reset.create': {
    methods: ["GET","HEAD"]
    pattern: '/forgot-password'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['create']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['create']>>>
    }
  }
  'password_reset.store': {
    methods: ["POST"]
    pattern: '/forgot-password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').passwordResetRequestValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').passwordResetRequestValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'password_reset.sent': {
    methods: ["GET","HEAD"]
    pattern: '/forgot-password/sent'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['sent']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['sent']>>>
    }
  }
  'password_reset.link': {
    methods: ["GET","HEAD"]
    pattern: '/reset-password/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['link']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['link']>>>
    }
  }
  'password_reset.edit': {
    methods: ["GET","HEAD"]
    pattern: '/reset-password'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['edit']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['edit']>>>
    }
  }
  'password_reset.update': {
    methods: ["POST"]
    pattern: '/reset-password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').newPasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').newPasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/password_reset_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
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
  'tenant.today': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/today'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/today_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/today_controller').default['show']>>>
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
  'tenant.settings.cover.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/cover'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/tenant').coverValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/tenant').coverValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/studio_cover_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/studio_cover_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.cover.destroy': {
    methods: ["DELETE"]
    pattern: '/t/:tenant/settings/cover'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/studio_cover_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/studio_cover_controller').default['destroy']>>>
    }
  }
  'tenant.settings.look': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/settings/look'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/page_look_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/page_look_controller').default['show']>>>
    }
  }
  'tenant.settings.look.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/look'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/tenant').updateLookValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/tenant').updateLookValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/page_look_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/page_look_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.logo.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/logo'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/tenant').logoValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/tenant').logoValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/studio_logo_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/studio_logo_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.logo.destroy': {
    methods: ["DELETE"]
    pattern: '/t/:tenant/settings/logo'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/studio_logo_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/studio_logo_controller').default['destroy']>>>
    }
  }
  'tenant.settings.logo.tile.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/logo/tile'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/tenant').logoTileValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/tenant').logoTileValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/studio_logo_controller').default['tile']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/studio_logo_controller').default['tile']>>> | { status: 422; response: { errors: SimpleError[] } }
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
  'tenant.settings.good_to_know': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/settings/good-to-know'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['show']>>>
    }
  }
  'tenant.settings.good_to_know.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/good-to-know'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/good_to_know').updateGoodToKnowValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/good_to_know').updateGoodToKnowValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.hours.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/hours'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/scheduling/validators/opening_hours').openingHoursValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/scheduling/validators/opening_hours').openingHoursValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['updateHours']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['updateHours']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.closed_days.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/settings/closed-days'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/scheduling/validators/opening_hours').closedDaysValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/scheduling/validators/opening_hours').closedDaysValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['storeClosedDays']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['storeClosedDays']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.closed_days.destroy': {
    methods: ["DELETE"]
    pattern: '/t/:tenant/settings/closed-days/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['destroyClosedDays']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/good_to_know_controller').default['destroyClosedDays']>>>
    }
  }
  'tenant.settings.members': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/settings/members'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['index']>>>
    }
  }
  'tenant.settings.members.invitations.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/settings/members/invitations'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/members').inviteValidator)>>
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/members').inviteValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['invite']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['invite']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.members.invitations.renew': {
    methods: ["POST"]
    pattern: '/t/:tenant/settings/members/invitations/:id/renew'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['renew']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['renew']>>>
    }
  }
  'tenant.settings.members.invitations.destroy': {
    methods: ["DELETE"]
    pattern: '/t/:tenant/settings/members/invitations/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['revoke']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['revoke']>>>
    }
  }
  'tenant.settings.members.role.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/settings/members/:id/role'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/tenancy/validators/members').memberRoleValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/tenancy/validators/members').memberRoleValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['role']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['role']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.settings.members.destroy': {
    methods: ["DELETE"]
    pattern: '/t/:tenant/settings/members/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/members_controller').default['remove']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/members_controller').default['remove']>>>
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
  'tenant.artists.mine': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/artists/mine'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['mine']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/artists_controller').default['mine']>>>
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
  'tenant.artists.photos.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/artists/:id/photos'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/artists/validators/work_photo').addWorkPhotoValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/artists/validators/work_photo').addWorkPhotoValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/work_photos_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/work_photos_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.artists.photos.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/artists/photos/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/artists/validators/work_photo').updateWorkPhotoValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/artists/validators/work_photo').updateWorkPhotoValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/work_photos_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/work_photos_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.artists.photos.destroy': {
    methods: ["DELETE"]
    pattern: '/t/:tenant/artists/photos/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/work_photos_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/work_photos_controller').default['destroy']>>>
    }
  }
  'tenant.artists.flash.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/artists/:id/flash'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/flash/validators/flash_design').addFlashDesignValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/flash/validators/flash_design').addFlashDesignValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/flash_designs_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/flash_designs_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.artists.flash.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/artists/flash/:id'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/flash/validators/flash_design').updateFlashDesignValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/flash/validators/flash_design').updateFlashDesignValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/flash_designs_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/flash_designs_controller').default['update']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.artists.flash.claim.update': {
    methods: ["PUT"]
    pattern: '/t/:tenant/artists/flash/:id/claim'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/flash/validators/flash_design').claimFlashDesignValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/flash/validators/flash_design').claimFlashDesignValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/flash_designs_controller').default['claim']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/flash_designs_controller').default['claim']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'tenant.artists.flash.destroy': {
    methods: ["DELETE"]
    pattern: '/t/:tenant/artists/flash/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/flash_designs_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/flash_designs_controller').default['destroy']>>>
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
  'tenant.inbox.contacted.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/inbox/:id/contacted'
    types: {
      body: ExtractBody<InferInput<(typeof import('#modules/notifications/validators/contact').contactValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/notifications/validators/contact').contactValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['contacted']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/inquiries_controller').default['contacted']>>> | { status: 422; response: { errors: SimpleError[] } }
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
      body: ExtractBody<InferInput<(typeof import('#modules/notifications/validators/contact').contactValidator)>>
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: ExtractQuery<InferInput<(typeof import('#modules/notifications/validators/contact').contactValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['contacted']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['contacted']>>> | { status: 422; response: { errors: SimpleError[] } }
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
  'tenant.projects.finish.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/finish'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['finish']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['finish']>>>
    }
  }
  'tenant.projects.complete.store': {
    methods: ["POST"]
    pattern: '/t/:tenant/projects/:id/complete'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['complete']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/project_changes_controller').default['complete']>>>
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
  'tenant.alerts.index': {
    methods: ["GET","HEAD"]
    pattern: '/t/:tenant/alerts'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/alerts_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/alerts_controller').default['index']>>>
    }
  }
  'tenant.alerts.read': {
    methods: ["POST"]
    pattern: '/t/:tenant/alerts/read'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/alerts_controller').default['readAll']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/alerts_controller').default['readAll']>>>
    }
  }
  'tenant.alerts.open': {
    methods: ["POST"]
    pattern: '/t/:tenant/alerts/:id/open'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/alerts_controller').default['open']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/alerts_controller').default['open']>>>
    }
  }
  'email_verification.link': {
    methods: ["GET","HEAD"]
    pattern: '/verify-email/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['link']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['link']>>>
    }
  }
  'email_verification.show': {
    methods: ["GET","HEAD"]
    pattern: '/verify-email'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['show']>>>
    }
  }
  'email_verification.confirm': {
    methods: ["POST"]
    pattern: '/verify-email'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['confirm']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['confirm']>>>
    }
  }
  'invitations.link': {
    methods: ["GET","HEAD"]
    pattern: '/invitations/:token'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { token: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['link']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['link']>>>
    }
  }
  'invitations.show': {
    methods: ["GET","HEAD"]
    pattern: '/invitations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['show']>>>
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
  'email_verification.notice': {
    methods: ["GET","HEAD"]
    pattern: '/confirm-email'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['notice']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['notice']>>>
    }
  }
  'email_verification.resend': {
    methods: ["POST"]
    pattern: '/confirm-email'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['resend']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/email_verification_controller').default['resend']>>>
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
  'invitations.accept': {
    methods: ["POST"]
    pattern: '/invitations'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['accept']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/invitations_controller').default['accept']>>>
    }
  }
  'account.show': {
    methods: ["GET","HEAD"]
    pattern: '/account'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/account_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/account_controller').default['show']>>>
    }
  }
  'account.password.update': {
    methods: ["PUT"]
    pattern: '/account/password'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').changePasswordValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').changePasswordValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/account_controller').default['changePassword']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/account_controller').default['changePassword']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'account.sign_out_others': {
    methods: ["POST"]
    pattern: '/account/sign-out-others'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/account_controller').default['signOutOthers']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/account_controller').default['signOutOthers']>>>
    }
  }
  'api.v1.styles.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/styles'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_styles_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_styles_controller').default['index']>>>
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
  'api.v1.work.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/tenants/:tenant/work'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#modules/storefront/validators/work').listWorkValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_work_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_work_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'api.v1.flash.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/tenants/:tenant/flash'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { tenant: ParamValue }
      query: ExtractQueryForGet<InferInput<(typeof import('#modules/storefront/validators/flash').listFlashValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_flash_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_flash_controller').default['index']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'api.v1.flash.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/v1/tenants/:tenant/flash/:design'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { tenant: ParamValue; design: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/public_flash_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/public_flash_controller').default['show']>>>
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
