import { Form } from "@adonisjs/inertia/react";
import { useState } from "react";
import { type MessageKindName, previewMessage } from "~/components/messages";
import Section from "~/components/section";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type MessageSetting = {
	kind: MessageKindName;
	label: string;
	offered: string;
	text: string;
	defaultText: string;
	placeholders: { name: string; help: string }[];
};

/**
 * Settings, Messages (TAT-52): the six chat messages staff send with one
 * tap. One form, so each error shows under its own box; each preview
 * follows its box as it is typed.
 */
export default function Messages({
	messages,
	sample,
}: {
	messages: MessageSetting[];
	sample: Record<string, string>;
}) {
	const tenant = useTenant();
	const [texts, setTexts] = useState<Record<string, string>>(() =>
		Object.fromEntries(messages.map(({ kind, text }) => [kind, text])),
	);
	const setText = (kind: MessageKindName, text: string) =>
		setTexts((current) => ({ ...current, [kind]: text }));

	return (
		<Form
			route="tenant.settings.messages.update"
			routeParams={{ tenant: tenant.slug }}
			options={{ preserveScroll: true, preserveState: "errors" }}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					{messages.map((message) => {
						const text = texts[message.kind] ?? "";
						const error = errors[message.kind];
						const id = `message-${message.kind}`;
						return (
							<Section
								key={message.kind}
								title={message.label}
								description={message.offered}
							>
								<div className="flex flex-col gap-3">
									<Field data-invalid={!!error}>
										<FieldLabel htmlFor={id} className="sr-only">
											{message.label}
										</FieldLabel>
										<Textarea
											id={id}
											name={message.kind}
											rows={6}
											value={text}
											onChange={(event) =>
												setText(message.kind, event.target.value)
											}
											aria-invalid={!!error}
											aria-describedby={
												error
													? `${id}-error ${id}-placeholders`
													: `${id}-placeholders`
											}
										/>
										{error && (
											<FieldError id={`${id}-error`}>{error}</FieldError>
										)}
										<FieldDescription id={`${id}-placeholders`}>
											Placeholders:
										</FieldDescription>
										<ul className="flex flex-col gap-1 text-xs text-muted-foreground">
											{message.placeholders.map(({ name, help }) => (
												<li key={name}>
													<code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
														{`{${name}}`}
													</code>{" "}
													{help}
												</li>
											))}
										</ul>
									</Field>
									<div className="flex flex-col gap-1">
										<p className="text-xs font-medium text-muted-foreground">
											Preview with example details
										</p>
										<p className="rounded-md bg-muted/50 p-3 text-sm break-words whitespace-pre-line">
											{previewMessage(
												text,
												message.placeholders.map(({ name }) => name),
												sample,
											)}
										</p>
									</div>
									{text !== message.defaultText && (
										<div>
											<Button
												type="button"
												variant="ghost"
												className="h-11"
												onClick={() =>
													setText(message.kind, message.defaultText)
												}
											>
												Reset to default
											</Button>
										</div>
									)}
								</div>
							</Section>
						);
					})}
					<div>
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Save messages"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

Messages.layout = [AppLayout, SettingsLayout];
