import Page from "~/components/page";
import AppLayout from "~/layouts/app";

/** The person's account page (TAT-95). A placeholder until the next task fills it. */
export default function AccountPage({ hasStudio }: { hasStudio: boolean }) {
	return <Page title="Your account" description={String(hasStudio)} />;
}

AccountPage.layout = [AppLayout];
