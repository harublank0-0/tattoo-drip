/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  drive: {
    public: {
      serve: typeof routes['drive.public.serve']
    }
    private: {
      serve: typeof routes['drive.private.serve']
    }
  }
  home: typeof routes['home']
  newAccount: {
    create: typeof routes['new_account.create']
    store: typeof routes['new_account.store']
  }
  session: {
    create: typeof routes['session.create']
    store: typeof routes['session.store']
    destroy: typeof routes['session.destroy']
  }
  tenant: {
    dashboard: typeof routes['tenant.dashboard']
    settings: typeof routes['tenant.settings'] & {
      profile: typeof routes['tenant.settings.profile'] & {
        update: typeof routes['tenant.settings.profile.update']
      }
      payments: typeof routes['tenant.settings.payments'] & {
        create: typeof routes['tenant.settings.payments.create']
        edit: typeof routes['tenant.settings.payments.edit']
        move: typeof routes['tenant.settings.payments.move']
        destroy: typeof routes['tenant.settings.payments.destroy']
      }
      deposits: {
        update: typeof routes['tenant.settings.deposits.update']
      }
    }
  }
  dashboard: typeof routes['dashboard']
  onboarding: {
    create: typeof routes['onboarding.create']
    store: typeof routes['onboarding.store']
  }
}
