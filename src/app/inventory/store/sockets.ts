import {
  DestinyItemComponent,
  DestinyInventoryItemDefinition,
  DestinyItemSocketEntryDefinition,
  DestinyItemSocketState,
  DestinyItemSocketEntryPlugItemDefinition,
  DestinyItemComponentSetOfint64,
  DestinyItemPlugBase,
  DestinyObjectiveProgress,
  DestinySocketCategoryStyle,
} from 'bungie-api-ts/destiny2';
import { D2ManifestDefinitions } from 'app/destiny2/d2-definitions';
import { DimSockets, DimSocketCategory, DimSocket, DimPlug } from '../item-types';
import { compareBy } from 'app/utils/comparators';
import _ from 'lodash';
import { EXCLUDED_PLUGS } from 'app/search/d2-known-values';
import { ItemCategoryHashes } from 'data/d2/generated-enums';

//
// These are the utilities that deal with Sockets and Plugs on items. Sockets and Plugs
// are how perks, mods, and many other things are implemented on items.
//
// This is called from within d2-item-factory.service.ts
//

/**
 * Calculate all the sockets we want to display (or make searchable). Sockets represent perks,
 * mods, and intrinsic properties of the item. They're really the swiss army knife of item
 * customization.
 */
export function buildSockets(
  item: DestinyItemComponent,
  itemComponents: DestinyItemComponentSetOfint64 | undefined,
  defs: D2ManifestDefinitions,
  itemDef: DestinyInventoryItemDefinition
) {
  let sockets: DimSockets | null = null;
  let missingSockets = false;

  const socketData =
    (item.itemInstanceId && itemComponents?.sockets?.data?.[item.itemInstanceId]?.sockets) ||
    undefined;
  const reusablePlugData =
    (item.itemInstanceId && itemComponents?.reusablePlugs?.data?.[item.itemInstanceId]?.plugs) ||
    undefined;
  const plugObjectivesData =
    (item.itemInstanceId &&
      itemComponents?.plugObjectives?.data?.[item.itemInstanceId]?.objectivesPerPlug) ||
    undefined;
  if (socketData) {
    sockets = buildInstancedSockets(
      defs,
      itemDef,
      item,
      socketData,
      reusablePlugData,
      plugObjectivesData
    );
  }

  // If we didn't have live data (for example, when viewing vendor items or collections),
  // get sockets from the item definition.
  if (!sockets && itemDef.sockets) {
    // If this really *should* have live sockets, but didn't...
    if (item.itemInstanceId && socketData && !socketData[item.itemInstanceId]) {
      missingSockets = true;
    }
    sockets = buildDefinedSockets(defs, itemDef);
  }

  return { sockets, missingSockets };
}

/**
 * Build sockets that come from the live instance.
 */
export function buildInstancedSockets(
  defs: D2ManifestDefinitions,
  itemDef: DestinyInventoryItemDefinition,
  item: DestinyItemComponent,
  sockets?: DestinyItemSocketState[],
  reusablePlugData?: {
    [key: number]: DestinyItemPlugBase[];
  },
  plugObjectivesData?: {
    [key: number]: DestinyObjectiveProgress[];
  }
): DimSockets | null {
  if (
    !item.itemInstanceId ||
    !itemDef.sockets ||
    !itemDef.sockets.socketEntries.length ||
    !sockets ||
    !sockets.length
  ) {
    return null;
  }

  const realSockets: (DimSocket | undefined)[] = [];
  for (let i = 0; i < sockets.length; i++) {
    const built = buildSocket(
      defs,
      sockets[i],
      itemDef.sockets.socketEntries[i],
      i,
      reusablePlugData?.[i],
      plugObjectivesData
    );

    realSockets.push(built);
  }

  const categories: DimSocketCategory[] = [];

  for (const category of itemDef.sockets.socketCategories) {
    const sockets: DimSocket[] = [];
    for (const index of category.socketIndexes) {
      const s = realSockets[index];
      if (s) {
        sockets.push(s);
      }
    }

    categories.push({
      category: defs.SocketCategory.get(category.socketCategoryHash),
      sockets,
    });
  }

  return {
    sockets: _.compact(realSockets), // Flat list of sockets
    categories: categories.sort(compareBy((c) => c.category.index)), // Sockets organized by category
  };
}

/**
 * Build sockets that come from only the definition. We won't be able to tell which ones are selected.
 */
function buildDefinedSockets(
  defs: D2ManifestDefinitions,
  itemDef: DestinyInventoryItemDefinition
): DimSockets | null {
  const sockets = itemDef.sockets.socketEntries;
  if (!sockets || !sockets.length) {
    return null;
  }

  const realSockets: (DimSocket | undefined)[] = [];
  // TODO: check out intrinsicsockets as well

  for (let i = 0; i < sockets.length; i++) {
    const socket = sockets[i];
    realSockets.push(buildDefinedSocket(defs, socket, i, itemDef));
  }

  const categories: DimSocketCategory[] = [];

  for (const category of itemDef.sockets.socketCategories) {
    const sockets: DimSocket[] = [];

    for (const index of category.socketIndexes) {
      const s = realSockets[index];
      if (s?.plugOptions.length) {
        sockets.push(s);
      }
    }

    categories.push({
      category: defs.SocketCategory.get(category.socketCategoryHash),
      sockets,
    });
  }

  return {
    sockets: _.compact(realSockets), // Flat list of sockets
    categories: categories.sort(compareBy((c) => c.category.index)), // Sockets organized by category
  };
}

function filterReusablePlug(reusablePlug: DimPlug) {
  const itemCategoryHashes = reusablePlug.plugItem.itemCategoryHashes || [];
  return (
    !EXCLUDED_PLUGS.has(reusablePlug.plugItem.hash) &&
    !itemCategoryHashes.includes(ItemCategoryHashes.MasterworksMods) &&
    !itemCategoryHashes.includes(ItemCategoryHashes.GhostModsProjections) &&
    (!reusablePlug.plugItem.plug ||
      !reusablePlug.plugItem.plug.plugCategoryIdentifier.includes('masterworks.stat'))
  );
}

/**
 * Build a socket from definitions, without the benefit of live profile info.
 */
function buildDefinedSocket(
  defs: D2ManifestDefinitions,
  socketDef: DestinyItemSocketEntryDefinition,
  index: number,
  forThisItem?: DestinyInventoryItemDefinition
): DimSocket | undefined {
  if (!socketDef) {
    return undefined;
  }

  const socketTypeDef = defs.SocketType.get(socketDef.socketTypeHash, forThisItem);
  if (!socketTypeDef) {
    return undefined;
  }
  const socketCategoryDef = defs.SocketCategory.get(socketTypeDef.socketCategoryHash, forThisItem);
  if (!socketCategoryDef) {
    return undefined;
  }

  // Is this socket a perk-style socket, or something more general (mod-like)?
  const isPerk =
    socketCategoryDef.categoryStyle === DestinySocketCategoryStyle.Reusable ||
    socketCategoryDef.categoryStyle === DestinySocketCategoryStyle.Unlockable ||
    socketCategoryDef.categoryStyle === DestinySocketCategoryStyle.LargePerk;

  // The currently equipped plug, if any
  const reusablePlugs: DimPlug[] = [];

  // We only build a larger list of plug options if this is a perk socket, since users would
  // only want to see (and search) the plug options for perks. For other socket types (mods, shaders, etc.)
  // we will only populate plugOptions with the currently inserted plug.
  if (isPerk) {
    if (socketDef.reusablePlugSetHash) {
      const plugSet = defs.PlugSet.get(socketDef.reusablePlugSetHash, forThisItem);
      if (plugSet) {
        for (const reusablePlug of plugSet.reusablePlugItems) {
          const built = buildDefinedPlug(defs, reusablePlug);
          if (built) {
            reusablePlugs.push(built);
          }
        }
      }
    } else if (socketDef.reusablePlugItems) {
      for (const reusablePlug of socketDef.reusablePlugItems) {
        const built = buildDefinedPlug(defs, reusablePlug);
        if (built) {
          reusablePlugs.push(built);
        }
      }
    }
  }

  const plugOptions: DimPlug[] = [];

  if (reusablePlugs.length) {
    for (const reusablePlug of reusablePlugs) {
      if (filterReusablePlug(reusablePlug)) {
        plugOptions.push(reusablePlug);
      }
    }
  }

  return {
    socketIndex: index,
    plug: null,
    plugOptions,
    reusablePlugItems: [],
    hasRandomizedPlugItems:
      Boolean(socketDef.randomizedPlugSetHash) || socketTypeDef.alwaysRandomizeSockets,
    isPerk,
    socketDefinition: socketDef,
  };
}

function isDestinyItemPlug(
  plug: DestinyItemPlugBase | DestinyItemSocketState
): plug is DestinyItemPlugBase {
  return Boolean((plug as DestinyItemPlugBase).plugItemHash);
}

function buildPlug(
  defs: D2ManifestDefinitions,
  plug: DestinyItemPlugBase | DestinyItemSocketState,
  socketDef: DestinyItemSocketEntryDefinition,
  plugObjectivesData?: {
    [plugItemHash: number]: DestinyObjectiveProgress[];
  }
): DimPlug | null {
  const plugHash = isDestinyItemPlug(plug) ? plug.plugItemHash : plug.plugHash;
  const enabled = isDestinyItemPlug(plug) ? plug.enabled : plug.isEnabled;

  if (!plugHash) {
    return null;
  }

  let plugItem = defs.InventoryItem.get(plugHash);
  if (!plugItem && socketDef.singleInitialItemHash) {
    plugItem = defs.InventoryItem.get(socketDef.singleInitialItemHash);
  }

  if (!plugItem) {
    return null;
  }

  const failReasons = plug.enableFailIndexes
    ? _.compact(
        plug.enableFailIndexes.map((index) => plugItem.plug.enabledRules[index]?.failureMessage)
      ).join('\n')
    : '';

  return {
    plugItem,
    enabled: enabled && (!isDestinyItemPlug(plug) || plug.canInsert),
    enableFailReasons: failReasons,
    plugObjectives: plugObjectivesData?.[plugHash] || [],
    perks: plugItem.perks ? plugItem.perks.map((perk) => defs.SandboxPerk.get(perk.perkHash)) : [],
    stats: null,
  };
}

function buildDefinedPlug(
  defs: D2ManifestDefinitions,
  plug: DestinyItemSocketEntryPlugItemDefinition
): DimPlug | null {
  const plugHash = plug.plugItemHash;

  const plugItem = plugHash && defs.InventoryItem.get(plugHash);
  if (!plugItem) {
    return null;
  }

  return {
    plugItem,
    enabled: true,
    enableFailReasons: '',
    plugObjectives: [],
    perks: (plugItem.perks || []).map((perk) => defs.SandboxPerk.get(perk.perkHash)),
    stats: null,
  };
}

/**
 * A helper function to add plug options to a socket. This maintains the socketed plug's position in the list.
 */
function addPlugOption(
  built: DimPlug | null,
  /** The active plug, which has already been built */
  plug: DimPlug | null,
  plugOptions: DimPlug[] // mutated
) {
  if (built && filterReusablePlug(built)) {
    if (plug && built.plugItem.hash === plug.plugItem.hash) {
      // Use the inserted plug we built earlier in this position, rather than the one we build from reusablePlugs.
      plugOptions.shift();
      plugOptions.push(plug);
    } else {
      // API Bugfix: Filter out intrinsic perks past the first: https://github.com/Bungie-net/api/issues/927
      if (!built.plugItem.itemCategoryHashes?.includes(ItemCategoryHashes.WeaponModsIntrinsic)) {
        plugOptions.push(built);
      }
    }
  }
}

/**
 * Build information about an individual socket, and its plugs, using live information.
 */
function buildSocket(
  defs: D2ManifestDefinitions,
  socket: DestinyItemSocketState,
  socketDef: DestinyItemSocketEntryDefinition | undefined,
  index: number,
  reusablePlugs?: DestinyItemPlugBase[],
  plugObjectivesData?: {
    [plugItemHash: number]: DestinyObjectiveProgress[];
  }
): DimSocket | undefined {
  if (
    !socketDef ||
    (!socket.isVisible &&
      // Keep the kill-tracker socket around even though it may not be visible
      // TODO: does this really happen? I think all these sockets are visible
      !(socket.plugHash && plugObjectivesData?.[socket.plugHash]?.length))
  ) {
    return undefined;
  }

  const socketTypeDef = defs.SocketType.get(socketDef.socketTypeHash);
  if (!socketTypeDef) {
    return undefined;
  }
  const socketCategoryDef = defs.SocketCategory.get(socketTypeDef.socketCategoryHash);
  if (!socketCategoryDef) {
    return undefined;
  }

  // Is this socket a perk-style socket, or something more general (mod-like)?
  const isPerk =
    socketCategoryDef.categoryStyle === DestinySocketCategoryStyle.Reusable ||
    socketCategoryDef.categoryStyle === DestinySocketCategoryStyle.Unlockable ||
    socketCategoryDef.categoryStyle === DestinySocketCategoryStyle.LargePerk;

  // The currently equipped plug, if any.
  const plug = buildPlug(defs, socket, socketDef, plugObjectivesData);
  // TODO: not sure if this should always be included!
  const plugOptions = plug ? [plug] : [];

  // We only build a larger list of plug options if this is a perk socket, since users would
  // only want to see (and search) the plug options for perks. For other socket types (mods, shaders, etc.)
  // we will only populate plugOptions with the currently inserted plug.
  if (isPerk) {
    if (reusablePlugs) {
      // Get options from live info
      for (const reusablePlug of reusablePlugs) {
        const built = buildPlug(defs, reusablePlug, socketDef, plugObjectivesData);
        addPlugOption(built, plug, plugOptions);
      }
    } else if (socketDef.reusablePlugSetHash) {
      // Get options from plug set, instead of live info
      const plugSet = defs.PlugSet.get(socketDef.reusablePlugSetHash);
      for (const reusablePlug of plugSet.reusablePlugItems) {
        const built = buildDefinedPlug(defs, reusablePlug);
        addPlugOption(built, plug, plugOptions);
      }
    } else if (socketDef.reusablePlugItems) {
      // Get options from definition itself
      for (const reusablePlug of socketDef.reusablePlugItems) {
        const built = buildDefinedPlug(defs, reusablePlug);
        addPlugOption(built, plug, plugOptions);
      }
    }
  }

  // TODO: is this still true? also, should this be ?? instead of ||
  const hasRandomizedPlugItems =
    Boolean(socketDef?.randomizedPlugSetHash) || socketTypeDef.alwaysRandomizeSockets;

  return {
    socketIndex: index,
    plug,
    plugOptions,
    hasRandomizedPlugItems,
    reusablePlugItems: reusablePlugs,
    isPerk,
    socketDefinition: socketDef,
  };
}
