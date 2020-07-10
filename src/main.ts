import { Flaggable } from './macros/macroMarkerFlags';
import { MarkerConfigurationFlags } from './markerConfiguration/markerConfigurationFlags';
import { markerToggler } from './hotbar/markerToggler';
import { MacroMarker } from './macros/macroMarker';
import CONSTANTS from './utils/constants';
import { Settings } from './utils/settings';
import { ConsoleLogger, NotifiedLogger } from './utils/logger';
import { MacroMarkerConfig } from './markerConfiguration/macroMarkerConfig';
import { RemoteExecutor } from './remoteExecutor';
import { Extensions } from './utils/foundry';

declare class Hotbar {
    _onHoverMacro(event: Event, ...args: unknown[]): void;
}

Hooks.on('init', () => {
    Extensions.addEntityMarkerTypes();
    game.settings.register(CONSTANTS.module.name, Settings.keys.dimInactiveMacros, {
        name: 'Inactive macro brightness',
        hint: 'Makes inactive macros on the hotbar less bright. Set to 100 to disable the effect.',
        scope: 'world',
        config: true,
        default: 65,
        type: Number,
        range: { min: 50, max: 100, step: 5 },
        onChange: renderHotbars
    });

    game.settings.register(CONSTANTS.module.name, Settings.keys.defaultColour, {
        name: 'Default colour',
        hint: 'The default colour for active macros. Must be a valid CSS colour (e.g. hex, rgba or named).',
        scope: 'world',
        config: true,
        default: '#ff0000',
        type: String,
        onChange: colour => { 
            updateColour(colour);
            renderHotbars();
        }
    });

    game.settings.register(CONSTANTS.module.name, Settings.keys.borderWidth, {
        name: 'Border width',
        hint: 'The width for the active macro border.',
        scope: 'world',
        config: true,
        default: 2,
        type: Number,
        range: { min: 1, max: 4, step: 1 },
        onChange: renderHotbars
    });

    game.settings.register(CONSTANTS.module.name, Settings.keys.animationSpeed, {
        name: 'Animation speed',
        hint: 'The number of second it takes to complete a single animation. Use 0 to turn off animations.',
        scope: 'client',
        config: true,
        default: 3,
        type: Number,
        range: { min: 0, max: 10, step: 0.5 },
        onChange: renderHotbars
    });

    CONFIG.ui.hotbar =
        class extends Hotbar {
            _onHoverMacro(event, ...args) {
                super._onHoverMacro(event, ...args);
                if (event.type !== 'mouseenter')
                    return;

                const li: HTMLElement = event.currentTarget;
                const logger = new NotifiedLogger(new ConsoleLogger());
                const settings = Settings._load();
                const marker = new MacroMarker(logger, settings, game.user, () => canvas.tokens.controlled);
                new markerToggler(game.macros, logger, settings, marker).showTooltip(li, canvas.tokens.controlled[0]);
            }
        };
});

Hooks.on('ready', () => {
    const logger = new NotifiedLogger(new ConsoleLogger());
    RemoteExecutor.init(logger);
    window['MacroMarker'] = new MacroMarker(logger, Settings._load(), game.user, () => canvas.tokens.controlled);
    
    MacroMarkerConfig.init();
});

function updateColour(colour: string) {
    if (colour.startsWith('#'))
        return colour;

    const ctx = document.createElement('canvas')?.getContext('2d');
    if (!ctx)
        return;

    ctx.fillStyle = colour;
    const newColour = ctx.fillStyle;
    if (newColour.startsWith('#'))
        game.settings.set(CONSTANTS.module.name, Settings.keys.defaultColour, newColour);
    else
        ui.notifications.warn(`Macro Marker: Default colour '${colour}' is not a valid colour.`);
    return colour;
}

const timers = {};
function delayCallback(callback: (...args: unknown[]) => boolean, ...args: unknown[]) {
    if (timers[callback.name])
        window.clearTimeout(timers[callback.name]);

    timers[callback.name] = window.setTimeout(() => callback(...args), 100);
}

function renderMarkers(hotbar: HTMLElement) {
    const logger = new NotifiedLogger(new ConsoleLogger());
    const settings = Settings._load();
    const token: Token & Flaggable | undefined = canvas.tokens.controlled[0];
    const hotbarMarker = new markerToggler(
        game.macros,
        logger,
        settings,
        new MacroMarker(logger, Settings._load(), game.user, () => canvas.tokens.controlled));
        
    hotbarMarker.showMarkers(hotbar, token);

    return true;
}

function renderHotbars() {
    const hotbar = document.getElementById('action-bar');
    const customHotbar = document.getElementById('custom-action-bar');
    [ hotbar, customHotbar ].filter(x => x).map(renderMarkers);

    return true;
}

Hooks.on('renderHotbar', (_, hotbar) => delayCallback(renderMarkers, hotbar[0]));
Hooks.on('renderCustomHotbar', (_, hotbar) => delayCallback(renderMarkers, hotbar[0]));
Hooks.on('controlToken', () => delayCallback(renderHotbars));

// Save macro configuration
Hooks.on('preUpdateMacro', (macro, data) => {
    const activeData = data[CONSTANTS.module.name];
    if (!activeData)
        return;

    const logger = new NotifiedLogger(new ConsoleLogger());
    const flags = new MarkerConfigurationFlags(logger, macro);
    const oldData = flags.getData();
    flags.setData(Object.assign(oldData, activeData));

    return true;
});

Hooks.on('updateMacro', (macro, data) => {
    if (data.flags[CONSTANTS.module.name])
        renderHotbars();
});

Hooks.on('updateActor', (actor, data) => {
    if (data.flags?.[CONSTANTS.module.name])
        return;

    renderHotbars();
});

Hooks.on('updateToken', (scene, tokenData, updateData) => {
    if (updateData.flags?.[CONSTANTS.module.name])
        return;

    if (!updateData.actorData)
        return;

    renderHotbars();
});
