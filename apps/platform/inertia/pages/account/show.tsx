import { Form, type FormRef, Link } from "@adonisjs/inertia/react";
import { router, usePage } from "@inertiajs/react";
import { useEffect, useRef } from "react";
import { urlFor } from "~/client";
import {
	ACCOUNT_TITLE,
	backLabel,
	CHANGE_PASSWORD_INTRO,
	clearsFields,
	describedBy,
	FORGOT_CURRENT,
	NEW_PASSWORD_HINT,
	OTHER_DEVICES_INTRO,
	SIGN_OUT_OTHERS,
	submitLabel,
} from "~/components/account";
import { focusFirstInvalid } from "~/components/form_sheet";
import InlineConfirm from "~/components/inline_confirm";
import Page from "~/components/page";
import { takesFocusBack } from "~/components/page_look";
import Section from "~/components/section";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import AppLayout from "~/layouts/app";

/** What the change form posts (the route's body), for the form's ref. */
type PasswordBody = {
	currentPassword: string;
	password: string;
	passwordConfirmation: string;
};

/**
 * The person's own account, outside any studio (TAT-95): change the password,
 * and sign out of every other device. Both act on the signed-in account only.
 * Changing the password asks for the current one; a refusal shows under its
 * field and moves focus there, a saved change clears the form, toasts and
 * leaves focus on the button. "Sign out of other devices" asks in the page
 * (`InlineConfirm`, never the browser's dialog). The words are in
 * components/account.ts.
 */
export default function AccountPage({ hasStudio }: { hasStudio: boolean }) {
	const { user } = usePage().props;
	const heading = useRef<HTMLHeadingElement>(null);
	const fields = useRef<HTMLDivElement>(null);
	const form = useRef<FormRef<PasswordBody>>(null);
	if (!user) return null;

	return (
		<Page
			title={ACCOUNT_TITLE}
			titleRef={heading}
			description={
				<>
					Signed in as{" "}
					<strong className="font-medium text-foreground wrap-anywhere">
						{user.email}
					</strong>
				</>
			}
			actions={
				<Button asChild variant="outline">
					<Link route="dashboard">{backLabel(hasStudio)}</Link>
				</Button>
			}
		>
			<div className="flex max-w-xl min-w-0 flex-col">
				<Section title="Change password" description={CHANGE_PASSWORD_INTRO}>
					<Form
						ref={form}
						route="account.password.update"
						options={{ preserveScroll: true }}
						onSuccess={(page) => {
							// A refused limit is a good page too: only a saved change clears.
							if (clearsFields(page.flash)) form.current?.reset();
						}}
						onError={() => focusFirstInvalid(fields.current)}
					>
						{({ errors, processing }) => (
							<div className="flex flex-col gap-4">
								{/* Lets a password manager file the new password under this account. */}
								<input
									type="email"
									autoComplete="username"
									value={user.email}
									readOnly
									hidden
								/>
								<div ref={fields}>
									<FieldGroup>
										<Field data-invalid={!!errors.currentPassword}>
											<FieldLabel htmlFor="current-password">
												Current password
											</FieldLabel>
											<Input
												id="current-password"
												name="currentPassword"
												type="password"
												autoComplete="current-password"
												className="h-11"
												aria-invalid={!!errors.currentPassword}
												aria-describedby={describedBy(
													errors.currentPassword && "current-password-error",
												)}
											/>
											{errors.currentPassword && (
												<FieldError id="current-password-error">
													{errors.currentPassword}
												</FieldError>
											)}
										</Field>

										<Field data-invalid={!!errors.password}>
											<FieldLabel htmlFor="new-password">
												New password
											</FieldLabel>
											<Input
												id="new-password"
												name="password"
												type="password"
												autoComplete="new-password"
												className="h-11"
												aria-invalid={!!errors.password}
												aria-describedby={describedBy(
													"new-password-rules",
													errors.password && "new-password-error",
												)}
											/>
											<FieldDescription id="new-password-rules">
												{NEW_PASSWORD_HINT}
											</FieldDescription>
											{errors.password && (
												<FieldError id="new-password-error">
													{errors.password}
												</FieldError>
											)}
										</Field>

										<Field data-invalid={!!errors.passwordConfirmation}>
											<FieldLabel htmlFor="new-password-again">
												Confirm new password
											</FieldLabel>
											<Input
												id="new-password-again"
												name="passwordConfirmation"
												type="password"
												autoComplete="new-password"
												className="h-11"
												aria-invalid={!!errors.passwordConfirmation}
												aria-describedby={describedBy(
													errors.passwordConfirmation &&
														"new-password-again-error",
												)}
											/>
											{errors.passwordConfirmation && (
												<FieldError id="new-password-again-error">
													{errors.passwordConfirmation}
												</FieldError>
											)}
										</Field>
									</FieldGroup>
								</div>
								<PasswordButton processing={processing} />
								<p className="text-sm text-muted-foreground">
									{FORGOT_CURRENT}
								</p>
							</div>
						)}
					</Form>
				</Section>

				<Section title="Other devices" description={OTHER_DEVICES_INTRO}>
					<InlineConfirm
						label={SIGN_OUT_OTHERS.label}
						question={SIGN_OUT_OTHERS.question}
						confirmLabel={SIGN_OUT_OTHERS.confirm}
						keepLabel={SIGN_OUT_OTHERS.keep}
						busyLabel={SIGN_OUT_OTHERS.busy}
						fallback={heading}
						onConfirm={(finished) =>
							router.post(
								urlFor("account.sign_out_others"),
								{},
								{ preserveScroll: true, onFinish: finished },
							)
						}
					/>
				</Section>
			</div>
		</Page>
	);
}

/**
 * The form's submit button: disabled while it saves ("Changing…"), and when
 * the visit ends, if it had focus when it started and nothing else has focus
 * now, it takes focus back (a disabled focused button drops its focus to the
 * page: takesFocusBack, as the page look's Save button does). A refusal moves
 * focus on to the first invalid field afterwards (focusFirstInvalid), so the
 * keyboard user lands on the error.
 */
function PasswordButton({ processing }: { processing: boolean }) {
	const button = useRef<HTMLButtonElement>(null);
	const hadFocus = useRef(false);
	const wasProcessing = useRef(false);
	useEffect(() => {
		const active = document.activeElement;
		const otherHasFocus =
			active !== null && active !== document.body && active !== button.current;
		if (
			takesFocusBack(
				hadFocus.current,
				wasProcessing.current,
				processing,
				otherHasFocus,
			)
		) {
			button.current?.focus();
		}
		wasProcessing.current = processing;
	}, [processing]);

	return (
		<Button
			ref={button}
			type="submit"
			className="w-full sm:w-auto sm:self-start"
			disabled={processing}
			onFocus={() => {
				hadFocus.current = true;
			}}
			onBlur={() => {
				hadFocus.current = false;
			}}
		>
			{submitLabel(processing)}
		</Button>
	);
}

AccountPage.layout = [AppLayout];
