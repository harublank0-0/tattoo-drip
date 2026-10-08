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
      response: unknown
      errorResponse: unknown
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
}
