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
    inventory: {
      index: typeof routes['tenant.inventory.index']
      store: typeof routes['tenant.inventory.store']
      export: typeof routes['tenant.inventory.export']
      import: typeof routes['tenant.inventory.import']
      lots: {
        export: typeof routes['tenant.inventory.lots.export']
        expiry: typeof routes['tenant.inventory.lots.expiry']
      }
      show: typeof routes['tenant.inventory.show']
      update: typeof routes['tenant.inventory.update']
      movement: typeof routes['tenant.inventory.movement']
      tracking: typeof routes['tenant.inventory.tracking']
      archive: typeof routes['tenant.inventory.archive']
      restore: typeof routes['tenant.inventory.restore']
    }
    transactions: {
      index: typeof routes['tenant.transactions.index']
      export: typeof routes['tenant.transactions.export']
      sync: typeof routes['tenant.transactions.sync']
    }
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
        tile: {
          update: typeof routes['tenant.settings.logo.tile.update']
        }
      }
      payments: typeof routes['tenant.settings.payments'] & {
        create: typeof routes['tenant.settings.payments.create']
        store: typeof routes['tenant.settings.payments.store']
        update: typeof routes['tenant.settings.payments.update']
        edit: typeof routes['tenant.settings.payments.edit']
        move: typeof routes['tenant.settings.payments.move']
        destroy: typeof routes['tenant.settings.payments.destroy']
      }
      onlinePayments: typeof routes['tenant.settings.online_payments'] & {
        connect: typeof routes['tenant.settings.online_payments.connect']
        disconnect: typeof routes['tenant.settings.online_payments.disconnect']
      }
      billing: typeof routes['tenant.settings.billing'] & {
        subscribe: typeof routes['tenant.settings.billing.subscribe']
        cancel: typeof routes['tenant.settings.billing.cancel']
        changePlan: typeof routes['tenant.settings.billing.change_plan']
        sync: typeof routes['tenant.settings.billing.sync']
        pay: typeof routes['tenant.settings.billing.pay']
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
      faqPolicies: typeof routes['tenant.settings.faq_policies'] & {
        faq: {
          update: typeof routes['tenant.settings.faq_policies.faq.update']
        }
        policies: {
          update: typeof routes['tenant.settings.faq_policies.policies.update']
        }
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
        inventory: {
          update: typeof routes['tenant.settings.members.inventory.update']
        }
        destroy: typeof routes['tenant.settings.members.destroy']
      }
      discover: typeof routes['tenant.settings.discover'] & {
        preview: typeof routes['tenant.settings.discover.preview']
        place: {
          update: typeof routes['tenant.settings.discover.place.update']
        }
        listing: {
          store: typeof routes['tenant.settings.discover.listing.store']
          destroy: typeof routes['tenant.settings.discover.listing.destroy']
        }
      }
    }
    artists: typeof routes['tenant.artists'] & {
      mine: typeof routes['tenant.artists.mine']
      create: typeof routes['tenant.artists.create']
      store: typeof routes['tenant.artists.store']
      edit: typeof routes['tenant.artists.edit']
      update: typeof routes['tenant.artists.update']
      destroy: typeof routes['tenant.artists.destroy']
      discover: {
        update: typeof routes['tenant.artists.discover.update']
      }
      photos: {
        store: typeof routes['tenant.artists.photos.store']
        update: typeof routes['tenant.artists.photos.update']
        destroy: typeof routes['tenant.artists.photos.destroy']
        order: typeof routes['tenant.artists.photos.order']
        ungroup: typeof routes['tenant.artists.photos.ungroup']
        videos: {
          sign: typeof routes['tenant.artists.photos.videos.sign']
          store: typeof routes['tenant.artists.photos.videos.store']
          stage: typeof routes['tenant.artists.photos.videos.stage']
        }
      }
      flash: {
        store: typeof routes['tenant.artists.flash.store']
        update: typeof routes['tenant.artists.flash.update']
        claim: {
          update: typeof routes['tenant.artists.flash.claim.update']
        }
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
    portfolio: typeof routes['tenant.portfolio'] & {
      bulk: typeof routes['tenant.portfolio.bulk']
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
  admin: {
    billing: typeof routes['admin.billing']
    payments: typeof routes['admin.payments'] & {
      review: typeof routes['admin.payments.review']
    }
  }
  api: {
    v1: {
      webhooks: {
        platform: typeof routes['api.v1.webhooks.platform']
        studio: typeof routes['api.v1.webhooks.studio']
      }
      styles: {
        index: typeof routes['api.v1.styles.index']
      }
      discover: {
        studios: {
          index: typeof routes['api.v1.discover.studios.index']
          show: typeof routes['api.v1.discover.studios.show']
          artists: {
            index: typeof routes['api.v1.discover.studios.artists.index']
            show: typeof routes['api.v1.discover.studios.artists.show']
          }
        }
        artists: {
          index: typeof routes['api.v1.discover.artists.index']
          show: typeof routes['api.v1.discover.artists.show']
        }
        tattoos: {
          index: typeof routes['api.v1.discover.tattoos.index']
          show: typeof routes['api.v1.discover.tattoos.show']
        }
        styles: {
          index: typeof routes['api.v1.discover.styles.index']
        }
        locations: {
          index: typeof routes['api.v1.discover.locations.index']
        }
        sitemap: {
          index: typeof routes['api.v1.discover.sitemap.index']
        }
      }
      studio: typeof routes['api.v1.studio']
      artists: {
        index: typeof routes['api.v1.artists.index']
        show: typeof routes['api.v1.artists.show']
      }
      work: {
        index: typeof routes['api.v1.work.index']
        show: typeof routes['api.v1.work.show']
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
        checkout: typeof routes['api.v1.deposits.checkout']
      }
      review: {
        show: typeof routes['api.v1.review.show']
        update: typeof routes['api.v1.review.update']
        review: {
          destroy: typeof routes['api.v1.review.review.destroy']
        }
        post: {
          destroy: typeof routes['api.v1.review.post.destroy']
          order: typeof routes['api.v1.review.post.order']
        }
        photos: {
          store: typeof routes['api.v1.review.photos.store']
        }
        videos: {
          sign: typeof routes['api.v1.review.videos.sign']
          stage: typeof routes['api.v1.review.videos.stage']
          store: typeof routes['api.v1.review.videos.store']
        }
        media: {
          destroy: typeof routes['api.v1.review.media.destroy']
        }
      }
    }
  }
}
