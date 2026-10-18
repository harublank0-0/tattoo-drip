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
      slug: {
        update: typeof routes['tenant.settings.slug.update']
      }
      payments: typeof routes['tenant.settings.payments'] & {
        create: typeof routes['tenant.settings.payments.create']
        store: typeof routes['tenant.settings.payments.store']
        update: typeof routes['tenant.settings.payments.update']
        edit: typeof routes['tenant.settings.payments.edit']
        move: typeof routes['tenant.settings.payments.move']
        destroy: typeof routes['tenant.settings.payments.destroy']
      }
      deposits: {
        update: typeof routes['tenant.settings.deposits.update']
      }
    }
    artists: typeof routes['tenant.artists'] & {
      create: typeof routes['tenant.artists.create']
      store: typeof routes['tenant.artists.store']
      edit: typeof routes['tenant.artists.edit']
      update: typeof routes['tenant.artists.update']
      destroy: typeof routes['tenant.artists.destroy']
    }
    inbox: {
      index: typeof routes['tenant.inbox.index']
      show: typeof routes['tenant.inbox.show']
      accept: typeof routes['tenant.inbox.accept']
      decline: typeof routes['tenant.inbox.decline']
    }
    clients: {
      index: typeof routes['tenant.clients.index']
      show: typeof routes['tenant.clients.show']
      edit: typeof routes['tenant.clients.edit']
      update: typeof routes['tenant.clients.update']
    }
    projects: {
      create: typeof routes['tenant.projects.create']
      store: typeof routes['tenant.projects.store']
      index: typeof routes['tenant.projects.index']
      show: typeof routes['tenant.projects.show']
      quotes: {
        store: typeof routes['tenant.projects.quotes.store']
        accept: typeof routes['tenant.projects.quotes.accept']
      }
      price: {
        store: typeof routes['tenant.projects.price.store']
      }
      moves: {
        store: typeof routes['tenant.projects.moves.store']
      }
      notes: {
        update: typeof routes['tenant.projects.notes.update']
      }
      contacted: {
        store: typeof routes['tenant.projects.contacted.store']
      }
      artist: {
        update: typeof routes['tenant.projects.artist.update']
      }
      depositLink: {
        store: typeof routes['tenant.projects.deposit_link.store']
      }
      payments: {
        store: typeof routes['tenant.projects.payments.store']
      }
      refunds: {
        store: typeof routes['tenant.projects.refunds.store']
      }
      depositOutcome: {
        store: typeof routes['tenant.projects.deposit_outcome.store']
      }
    }
    payments: {
      verify: typeof routes['tenant.payments.verify']
      reject: typeof routes['tenant.payments.reject']
      reverse: typeof routes['tenant.payments.reverse']
    }
    sessions: {
      outcome: typeof routes['tenant.sessions.outcome']
      move: typeof routes['tenant.sessions.move']
    }
    calendar: {
      index: typeof routes['tenant.calendar.index']
    }
  }
  dashboard: typeof routes['dashboard']
  onboarding: {
    create: typeof routes['onboarding.create']
    store: typeof routes['onboarding.store']
  }
  api: {
    v1: {
      studio: typeof routes['api.v1.studio']
      artists: {
        index: typeof routes['api.v1.artists.index']
        show: typeof routes['api.v1.artists.show']
      }
      inquiries: {
        store: typeof routes['api.v1.inquiries.store']
      }
      deposits: {
        show: typeof routes['api.v1.deposits.show']
        store: typeof routes['api.v1.deposits.store']
      }
    }
  }
}
