/**
 * dialogs.js — 通用输入弹窗（名称 / 提示文本）
 *
 * 取消按钮由 dom.js 统一接管（close('cancel')），这里只处理「确定」提交。
 */
import { el } from './dom.js';

export function openNameDialog(title, placeholder, okText) {
  return new Promise((resolve) => {
    el.nameDialogTitle.textContent = title;
    el.nameInput.value = '';
    el.nameInput.placeholder = placeholder || '';
    el.nameDialog.querySelector('#name-dialog-ok').textContent = okText || '创建';
    el.nameDialog.returnValue = '';
    el.nameDialog.showModal();
    el.nameInput.focus();
    // 只有"创建"会提交（preventDefault 后手动 close('ok')）；取消 / Esc 不产生 'ok' → resolve('')
    el.nameDialog.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      el.nameDialog.close('ok');
    };
    el.nameDialog.onclose = () => {
      resolve(el.nameDialog.returnValue === 'ok' ? el.nameInput.value.trim() : '');
    };
  });
}

/**
 * 通用输入弹窗（deploy / revert 的 commit message 等）。
 * 与 openNameDialog 同构：确定 → resolve(输入值)，取消/Esc → resolve('')。
 */
export function openPromptDialog({ title, label, value = '', placeholder = '', okText = '确定' }) {
  return new Promise((resolve) => {
    el.promptTitle.textContent = title;
    el.promptLabel.textContent = label;
    el.promptInput.value = value;
    el.promptInput.placeholder = placeholder;
    el.promptOk.textContent = okText;
    el.promptDialog.returnValue = '';
    el.promptDialog.showModal();
    el.promptInput.focus();
    el.promptInput.select();
    el.promptForm.onsubmit = (e) => {
      e.preventDefault();
      el.promptDialog.close('ok');
    };
    el.promptDialog.onclose = () => {
      resolve(el.promptDialog.returnValue === 'ok' ? el.promptInput.value.trim() : '');
    };
  });
}
