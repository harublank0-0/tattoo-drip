import { Form, Link } from "@adonisjs/inertia/react";
import Page from "~/components/page";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** Edits a client's name, phone, email and notes (TAT-41). Owners only. */
export default function ClientEdit({
	client,
}: {
	client: {
		id: string;
		name: string;
		phone: string;
		email: string | null;
		notes: string | null;
	};
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug, id: client.id };

	return (
		<Page title="Edit client" description={client.name}>
			<Card className="max-w-2xl">
				<CardContent>
					<Form route="tenant.clients.update" routeParams={params}>
						{({ errors, processing }) => (
							<FieldGroup>
								<Field data-invalid={!!errors.name}>
									<FieldLabel htmlFor="name">Name</FieldLabel>
									<Input
										id="name"
										name="name"
										defaultValue={client.name}
										maxLength={120}
										required
										aria-invalid={!!errors.name}
									/>
									{errors.name && <FieldError>{errors.name}</FieldError>}
								</Field>
								<Field data-invalid={!!errors.phone}>
									<FieldLabel htmlFor="phone">Phone</FieldLabel>
									<Input
										id="phone"
										name="phone"
										type="tel"
										inputMode="tel"
										defaultValue={client.phone}
										required
										aria-invalid={!!errors.phone}
									/>
									{errors.phone && <FieldError>{errors.phone}</FieldError>}
								</Field>
								<Field data-invalid={!!errors.email}>
									<FieldLabel htmlFor="email">Email (optional)</FieldLabel>
									<Input
										id="email"
										name="email"
										type="email"
										defaultValue={client.email ?? ""}
										maxLength={254}
										aria-invalid={!!errors.email}
									/>
									{errors.email && <FieldError>{errors.email}</FieldError>}
								</Field>
								<Field data-invalid={!!errors.notes}>
									<FieldLabel htmlFor="notes">Notes (optional)</FieldLabel>
									<Textarea
										id="notes"
										name="notes"
										rows={4}
										maxLength={2000}
										defaultValue={client.notes ?? ""}
										aria-invalid={!!errors.notes}
									/>
									{errors.notes && <FieldError>{errors.notes}</FieldError>}
								</Field>
								<div className="flex gap-2">
									<Button type="submit" disabled={processing}>
										{processing ? "Saving…" : "Save"}
									</Button>
									<Link
										route="tenant.clients.show"
										routeParams={params}
										className={buttonVariants({ variant: "ghost" })}
									>
										Cancel
									</Link>
								</div>
							</FieldGroup>
						)}
					</Form>
				</CardContent>
			</Card>
		</Page>
	);
}

ClientEdit.layout = [AppLayout];
