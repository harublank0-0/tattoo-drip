import Page from "~/components/page";
import type { TodayPageProps } from "~/components/today";
import AppLayout from "~/layouts/app";

/** Today (TAT-107): what needs you, the day's sessions, who to chase. */
export default function TodayIndex({ dateText }: TodayPageProps) {
	return <Page title="Today" description={dateText} />;
}

TodayIndex.layout = [AppLayout];
