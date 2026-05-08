import { homeWizardBatteryPlugin } from "./homewizard-battery";
import { indevoltBatteryPlugin } from "./indevolt-battery";
import { sonnenBatteryPlugin } from "./sonnen-battery";

export const batteryPlugins = [
  indevoltBatteryPlugin,
  sonnenBatteryPlugin,
  homeWizardBatteryPlugin,
];

export { homeWizardBatteryPlugin, indevoltBatteryPlugin, sonnenBatteryPlugin };
