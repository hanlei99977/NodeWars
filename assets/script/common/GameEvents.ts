export const GameEvents = {

    // --- 节点操作（UI → GameManager） ---
    NODE_UPGRADE:         'node:upgrade',
    NODE_CONVERT_FORTRESS: 'node:convertFortress',
    NODE_CONVERT_MARKET:  'node:convertMarket',
    NODE_RECRUIT:         'node:recruit',
    NODE_SEND_TROOPS:     'node:sendTroops',
    NODE_BATCH_UPGRADE_ALL:      'node:batchUpgradeAll',
    NODE_BATCH_UPGRADE_FORTRESS: 'node:batchUpgradeFortress',
    NODE_BATCH_UPGRADE_MARKET:   'node:batchUpgradeMarket',

    // --- 线路操作（UI → GameManager） ---
    EDGE_UPGRADE: 'edge:upgrade',

    // --- 面板 ---
    PANEL_CLOSE_NODE: 'panel:closeNode',
    PANEL_CLOSE_EDGE: 'panel:closeEdge',
    PANEL_CLOSE_ARMY: 'panel:closeArmy',

    // --- 游戏状态 ---
    GAME_RESTART: 'game:restart',
    GAME_LOBBY:   'game:lobby',
    GAME_SPEED_CHANGED: 'game:speedChanged',
    GAME_PAUSE_TOGGLE:  'game:pauseToggle',

    // --- 存档 ---
    SAVE_LOAD_SLOT:  'save:loadSlot',
    SAVE_DELETE_SLOT: 'save:deleteSlot',
    SAVE_SLOTS_CLOSE: 'save:slotsClose',

    // --- 行军事件（ArmyManager → GameManager） ---
    ARMY_ARRIVED_AT_NODE:  'army:arrivedAtNode',
    ARMY_EDGE_ENCOUNTER:   'army:edgeEncounter',

    // --- 战斗事件（NodeBattleSystem / ArmyCollisionSystem → GameManager） ---
    BATTLE_NODE_RESULT:    'battle:nodeResult',
    BATTLE_EDGE_RESULT:    'battle:edgeResult',

    // --- 经济事件（EconomySystem → UI / GameManager） ---
    ECONOMY_DISBAND_SOLDIERS: 'economy:disbandSoldiers',
    ECONOMY_GOLD_ZERO_WARNING: 'economy:goldZeroWarning',

    // --- 数据变更（供 UI 主动刷新） ---
    GOLD_CHANGED: 'data:goldChanged',

    // --- 随机事件（EventSystem → GameManager / UI） ---
    RANDOM_HARVEST:          'event:harvest',
    RANDOM_WAR_MOBILIZATION: 'event:warMobilization',

} as const;
