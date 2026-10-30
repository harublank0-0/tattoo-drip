import Section from "~/components/section";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

/**
 * Settings, Good to know (TAT-128). A stub until the page is built (it
 * renders so the controller's inertia.render resolves).
 */
export default function GoodToKnow() {
	return <Section title="Good to know">{null}</Section>;
}

GoodToKnow.layout = [AppLayout, SettingsLayout];
