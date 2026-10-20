import '@adonisjs/inertia/types'

import type React from 'react'
import type { Prettify } from '@adonisjs/core/types/common'

type ExtractProps<T> =
  T extends React.FC<infer Props>
    ? Prettify<Omit<Props, 'children'>>
    : T extends React.Component<infer Props>
      ? Prettify<Omit<Props, 'children'>>
      : never

declare module '@adonisjs/inertia/types' {
  export interface InertiaPages {
    'alerts/index': ExtractProps<(typeof import('../../inertia/pages/alerts/index.tsx'))['default']>
    'artists/form': ExtractProps<(typeof import('../../inertia/pages/artists/form.tsx'))['default']>
    'artists/index': ExtractProps<(typeof import('../../inertia/pages/artists/index.tsx'))['default']>
    'auth/check_email': ExtractProps<(typeof import('../../inertia/pages/auth/check_email.tsx'))['default']>
    'auth/confirm_email': ExtractProps<(typeof import('../../inertia/pages/auth/confirm_email.tsx'))['default']>
    'auth/forgot_password': ExtractProps<(typeof import('../../inertia/pages/auth/forgot_password.tsx'))['default']>
    'auth/login': ExtractProps<(typeof import('../../inertia/pages/auth/login.tsx'))['default']>
    'auth/reset_password': ExtractProps<(typeof import('../../inertia/pages/auth/reset_password.tsx'))['default']>
    'auth/signup': ExtractProps<(typeof import('../../inertia/pages/auth/signup.tsx'))['default']>
    'auth/verify_email': ExtractProps<(typeof import('../../inertia/pages/auth/verify_email.tsx'))['default']>
    'calendar/index': ExtractProps<(typeof import('../../inertia/pages/calendar/index.tsx'))['default']>
    'clients/edit': ExtractProps<(typeof import('../../inertia/pages/clients/edit.tsx'))['default']>
    'clients/index': ExtractProps<(typeof import('../../inertia/pages/clients/index.tsx'))['default']>
    'clients/show': ExtractProps<(typeof import('../../inertia/pages/clients/show.tsx'))['default']>
    'errors/not_found': ExtractProps<(typeof import('../../inertia/pages/errors/not_found.tsx'))['default']>
    'errors/server_error': ExtractProps<(typeof import('../../inertia/pages/errors/server_error.tsx'))['default']>
    'inquiries/index': ExtractProps<(typeof import('../../inertia/pages/inquiries/index.tsx'))['default']>
    'inquiries/show': ExtractProps<(typeof import('../../inertia/pages/inquiries/show.tsx'))['default']>
    'onboarding/create_tenant': ExtractProps<(typeof import('../../inertia/pages/onboarding/create_tenant.tsx'))['default']>
    'projects/index': ExtractProps<(typeof import('../../inertia/pages/projects/index.tsx'))['default']>
    'projects/new': ExtractProps<(typeof import('../../inertia/pages/projects/new.tsx'))['default']>
    'projects/show': ExtractProps<(typeof import('../../inertia/pages/projects/show.tsx'))['default']>
    'settings/members': ExtractProps<(typeof import('../../inertia/pages/settings/members.tsx'))['default']>
    'settings/messages': ExtractProps<(typeof import('../../inertia/pages/settings/messages.tsx'))['default']>
    'settings/payment_method_form': ExtractProps<(typeof import('../../inertia/pages/settings/payment_method_form.tsx'))['default']>
    'settings/payments': ExtractProps<(typeof import('../../inertia/pages/settings/payments.tsx'))['default']>
    'settings/profile': ExtractProps<(typeof import('../../inertia/pages/settings/profile.tsx'))['default']>
  }
}
