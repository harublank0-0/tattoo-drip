import { useAppForm } from "../../src/components/ui/form.tsx";

/** A two-field form for the toolkit's render test. */
export function FormDemo() {
	const form = useAppForm({ defaultValues: { name: "", pick: "b" } });
	return (
		<form>
			<form.AppField name="name">
				{(field) => (
					<field.TextField label="Name" description="A hint" required />
				)}
			</form.AppField>
			<form.AppField name="pick">
				{(field) => (
					<field.ChoiceField
						legend="Pick one"
						options={[
							{ value: "a", label: "A" },
							{ value: "b", label: "B" },
						]}
						required
					/>
				)}
			</form.AppField>
		</form>
	);
}
