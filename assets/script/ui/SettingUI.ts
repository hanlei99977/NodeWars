import { _decorator, Component, Label, Button, Slider, sys } from 'cc';
import { SaveSystem } from '../save/SaveSystem';

const { ccclass, property } = _decorator;

// 语言选项
export enum Language {
    ZH = 'zh',
    EN = 'en',
}

const LANGUAGE_NAMES: Record<Language, string> = {
    [Language.ZH]: '中文',
    [Language.EN]: 'English',
};

// 设置数据（持久化）
export interface SettingsData {
    musicVolume: number;
    sfxVolume: number;
    language: Language;
    fullscreen: boolean;
}

// 设置 UI，管理音效/语言/全屏/删除存档等配置
@ccclass('SettingUI')
export class SettingUI extends Component {

    // --- 音乐音量 ---
    @property(Slider)
    musicSlider: Slider | null = null;

    @property(Label)
    musicLabel: Label | null = null;

    // --- 音效音量 ---
    @property(Slider)
    sfxSlider: Slider | null = null;

    @property(Label)
    sfxLabel: Label | null = null;

    // --- 语言 ---
    @property(Label)
    languageLabel: Label | null = null;

    @property(Button)
    languageToggleBtn: Button | null = null;

    // --- 全屏 ---
    @property(Label)
    fullscreenLabel: Label | null = null;

    @property(Button)
    fullscreenToggleBtn: Button | null = null;

    // --- 删除存档 ---
    @property(Button)
    deleteSavesBtn: Button | null = null;

    // --- 关闭 ---
    @property(Button)
    closeBtn: Button | null = null;

    // --- 内部状态 ---
    private _settings: SettingsData = {
        musicVolume: 80,
        sfxVolume: 100,
        language: Language.ZH,
        fullscreen: false,
    };

    private static readonly STORAGE_KEY = 'nodewars_settings';

    // 外部回调
    onClose: (() => void) | null = null;

    // 静态方法：全局获取当前设置
    static get settings(): SettingsData {
        return SettingUI.loadSettings();
    }

    // 静态方法：加载设置
    static loadSettings(): SettingsData {
        try {
            const raw = sys.localStorage.getItem(SettingUI.STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as SettingsData;
                return { ...parsed };
            }
        } catch { /* ignore */ }
        return {
            musicVolume: 80,
            sfxVolume: 100,
            language: Language.ZH,
            fullscreen: false,
        };
    }

    // 静态方法：保存设置
    static saveSettings(settings: SettingsData): void {
        try {
            sys.localStorage.setItem(SettingUI.STORAGE_KEY, JSON.stringify(settings));
        } catch { /* ignore */ }
    }

    onLoad(): void {
        this._settings = SettingUI.loadSettings();
        this.applyFullscreen(this._settings.fullscreen);
        this.refreshAll();
    }

    // --- 音乐滑块 ---
    onMusicSliderChanged(): void {
        if (!this.musicSlider) return;
        this._settings.musicVolume = Math.round(this.musicSlider.progress * 100);
        this.refreshMusicLabel();
        SettingUI.saveSettings(this._settings);
    }

    // --- 音效滑块 ---
    onSfxSliderChanged(): void {
        if (!this.sfxSlider) return;
        this._settings.sfxVolume = Math.round(this.sfxSlider.progress * 100);
        this.refreshSfxLabel();
        SettingUI.saveSettings(this._settings);
    }

    // --- 语言切换 ---
    onLanguageToggle(): void {
        this._settings.language = this._settings.language === Language.ZH ? Language.EN : Language.ZH;
        this.refreshLanguageLabel();
        SettingUI.saveSettings(this._settings);
    }

    // --- 全屏切换 ---
    onFullscreenToggle(): void {
        this._settings.fullscreen = !this._settings.fullscreen;
        this.applyFullscreen(this._settings.fullscreen);
        this.refreshFullscreenLabel();
        SettingUI.saveSettings(this._settings);
    }

    // --- 删除所有存档 ---
    onDeleteSavesClicked(): void {
        const slots = SaveSystem.getSlotList();
        for (const slot of slots) {
            SaveSystem.deleteSlot(slot.slotId);
        }
        // 刷新按钮状态
        if (this.deleteSavesBtn) {
            const hasSaves = SaveSystem.getSlotList().some(s => !s.isEmpty);
            this.deleteSavesBtn.interactable = hasSaves;
        }
    }

    // --- 关闭 ---
    onCloseClicked(): void {
        if (this.onClose) this.onClose();
    }

    // --- 刷新 ---
    private refreshAll(): void {
        this.refreshMusicLabel();
        this.refreshSfxLabel();
        this.refreshLanguageLabel();
        this.refreshFullscreenLabel();
        this.refreshDeleteButton();
        this.syncSliders();
    }

    // -- 同步滑块位置 ---
    // 此处直接修改UI
    private syncSliders(): void {
        if (this.musicSlider) {
            this.musicSlider.progress = this._settings.musicVolume / 100;
        }
        if (this.sfxSlider) {
            this.sfxSlider.progress = this._settings.sfxVolume / 100;
        }
    }

    private refreshMusicLabel(): void {
        if (this.musicLabel) {
            this.musicLabel.string = `${this._settings.musicVolume}%`;
        }
    }

    private refreshSfxLabel(): void {
        if (this.sfxLabel) {
            this.sfxLabel.string = `${this._settings.sfxVolume}%`;
        }
    }

    private refreshLanguageLabel(): void {
        if (this.languageLabel) {
            this.languageLabel.string = LANGUAGE_NAMES[this._settings.language];
        }
    }

    private refreshFullscreenLabel(): void {
        if (this.fullscreenLabel) {
            this.fullscreenLabel.string = this._settings.fullscreen ? '开' : '关';
        }
    }

    private refreshDeleteButton(): void {
        if (this.deleteSavesBtn) {
            const hasSaves = SaveSystem.getSlotList().some(s => !s.isEmpty);
            this.deleteSavesBtn.interactable = hasSaves;
        }
    }

    // --- 应用全屏 ---
    private applyFullscreen(on: boolean): void {
        try {
            if (on) {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen();
                }
            } else {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                }
            }
        } catch { /* 浏览器不支持全屏 API 时忽略 */ }
    }
}
