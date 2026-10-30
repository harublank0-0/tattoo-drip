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
    sent: typeof routes['new_account.sent']
  }
  session: {
    create: typeof routes['session.create']
    store: typeof routes['session.store']
    destroy: typeof routes['session.destroy']
  }
  passwordReset: {
    create: typeof routes['password_reset.create']
    store: typeof routes['password_reset.store']
    sent: typeof routes['password_reset.sent']
    link: typeof routes['password_reset.link']
    edit: typeof routes['password_reset.edit']
    update: typeof routes['password_reset.update']
  }
  tenant: {
    dashboard: typeof routes['tenant.dashboard']
    today: typeof routes['tenant.today']
    settings: typeof routes['tenant.settings'] & {
      profile: typeof routes['tenant.settings.profile'] & {
        update: typeof routes['tenant.settings.profile.update']
      }
      slug: {
        update: typeof routes['tenant.settings.slug.update']
      }
      cover: {
        update: typeof routes['tenant.settings.cover.update']
        destroy: typeof routes['tenant.settings.cover.destroy']
      }
      look: typeof routes['tenant.settings.look'] & {
        update: typeof routes['tenant.settings.look.update']
      }
      logo: {
        update: typeof routes['tenant.settings.logo.update']
        destroy: typeof routes['tenant.settings.logo.destroy']
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
      messages: typeof routes['tenant.settings.messages'] & {
        update: typeof routes['tenant.settings.messages.update']
      }
      goodToKnow: typeof routes['tenant.settings.good_to_know'] & {
        update: typeof routes['tenant.settings.good_to_know.update']
      }
      hours: {
        update: typeof routes['tenant.settings.hours.update']
      }
      closedDays: {
        store: typeof routes['tenant.settings.closed_days.store']
        destroy: typeof routes['tenant.settings.closed_days.destroy']
      }
      members: typeof routes['tenant.settings.members'] & {
        invitations: {
          store: typeof routes['tenant.settings.members.invitations.store']
          renew: typeof routes['tenant.settings.members.invitations.renew']
          destroy: typeof routes['tenant.settings.members.invitations.destroy']
        }
        role: {
          update: typeof routes['tenant.settings.members.role.update']
        }
        destroy: typeof routes['tenant.settings.members.destroy']
      }
    }
    artists: typeof routes['tenant.artists'] & {
      mine: typeof routes['tenant.artists.mine']
      create: typeof routes['tenant.artists.create']
      store: typeof routes['tenant.artists.store']
      edit: typeof routes['tenant.artists.edit']
      update: typeof routes['tenant.artists.update']
      destroy: typeof routes['tenant.artists.destroy']
      photos: {
        store: typeof routes['tenant.artists.photos.store']
        update: typeof routes['tenant.artists.photos.update']
        destroy: typeof routes['tenant.artists.photos.destroy']
      }
      flash: {
        store: typeof routes['tenant.artists.flash.store']
        update: typeof routes['tenant.artists.flash.update']
        destroy: typeof routes['tenant.artists.flash.destroy']
      }
    }
    inbox: {
      index: typeof routes['tenant.inbox.index']
      show: typeof routes['tenant.inbox.show']
      accept: typeof routes['tenant.inbox.accept']
      decline: typeof routes['tenant.inbox.decline']
      contacted: {
        store: typeof routes['tenant.inbox.contacted.store']
      }
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
      finish: {
        store: typeof routes['tenant.projects.finish.store']
      }
      complete: {
        store: typeof routes['tenant.projects.complete.store']
      }
      sessions: {
        store: typeof routes['tenant.projects.sessions.store']
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
    alerts: {
      index: typeof routes['tenant.alerts.index']
      read: typeof routes['tenant.alerts.read']
      open: typeof routes['tenant.alerts.open']
    }
  }
  emailVerification: {
    link: typeof routes['email_verification.link']
    show: typeof routes['email_verification.show']
    confirm: typeof routes['email_verification.confirm']
    notice: typeof routes['email_verification.notice']
    resend: typeof routes['email_verification.resend']
  }
  invitations: {
    link: typeof routes['invitations.link']
    show: typeof routes['invitations.show']
    accept: typeof routes['invitations.accept']
  }
  dashboard: typeof routes['dashboard']
  onboarding: {
    create: typeof routes['onboarding.create']
    store: typeof routes['onboarding.store']
  }
  account: {
    show: typeof routes['account.show']
    password: {
      update: typeof routes['account.password.update']
    }
    signOutOthers: typeof routes['account.sign_out_others']
  }
  api: {
    v1: {
      styles: {
        index: typeof routes['api.v1.styles.index']
      }
      studio: typeof routes['api.v1.studio']
      artists: {
        index: typeof routes['api.v1.artists.index']
        show: typeof routes['api.v1.artists.show']
      }
      work: {
        index: typeof routes['api.v1.work.index']
      }
      flash: {
        index: typeof routes['api.v1.flash.index']
        show: typeof routes['api.v1.flash.show']
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
