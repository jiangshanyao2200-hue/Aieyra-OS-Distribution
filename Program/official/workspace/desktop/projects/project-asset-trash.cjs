const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { constants, createReadStream } = require('node:fs');
const inside = (root, file) => { const relative = path.relative(root, file); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };
async function hash(file) { const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex'); }

function createProjectAssetTrash({ trashItem }) {
  const receipts = new Map();
  async function trash(projectRoot, paths) {
    const root = await fs.realpath(projectRoot);
    const files = [];
    for (const input of [...new Set(paths || [])]) {
      const target = path.resolve(root, input);
      const real = await fs.realpath(target);
      if (!inside(root, real) || !inside(root, target) || /(?:^|[\\/])\.(?:iiimage|aieyra|git)(?:[\\/]|$)/i.test(path.relative(root, target)) ||
          !/\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?|heic|heif|psd)$/i.test(target) || !(await fs.lstat(target)).isFile()) throw new Error('只能删除当前项目内的图片成果，不能删除外部原图或项目配置。');
      files.push(target);
    }
    if (!files.length) return { token: '', count: 0 };
    const token = randomUUID();
    const directory = path.join(root, '.iiimage', 'trash-undo', token);
    await fs.mkdir(directory, { recursive: true });
    if (!inside(root, await fs.realpath(directory))) throw new Error('项目恢复目录已变化，删除已取消。');
    const entries = [];
    try {
      // Complete every recovery copy before touching any original file.
      for (let index = 0; index < files.length; index++) {
        const backup = path.join(directory, String(index) + path.extname(files[index]));
        await fs.copyFile(files[index], backup, constants.COPYFILE_EXCL);
        entries.push({ original: files[index], backup, hash: await hash(backup), trashed: false });
      }
      for (const entry of entries) { await trashItem(entry.original); entry.trashed = true; }
      receipts.set(token, { root, directory, entries });
      return { token, count: entries.length };
    } catch (error) {
      for (const entry of entries.filter(entry => entry.trashed)) await fs.copyFile(entry.backup, entry.original, constants.COPYFILE_EXCL);
      for (const entry of entries) await fs.unlink(entry.backup).catch(() => {});
      await fs.rmdir(directory).catch(() => {});
      throw error;
    }
  }
  async function receipt(projectRoot, token) {
    const record = receipts.get(token);
    if (!record || record.root !== await fs.realpath(projectRoot)) throw new Error('这次删除记录不属于当前项目或已失效。');
    return record;
  }
  async function forget(projectRoot, token) {
    const record = await receipt(projectRoot, token);
    for (const entry of record.entries) await fs.unlink(entry.backup).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(record.directory);
    receipts.delete(token);
  }
  async function restore(projectRoot, token) {
    const record = await receipt(projectRoot, token);
    const missing = [];
    for (const entry of record.entries) {
      try { if (await hash(entry.original) !== entry.hash) throw new Error('原路径已存在不同的文件，撤回不会覆盖它。'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; missing.push(entry); }
    }
    for (const entry of missing) {
      const parent = await fs.realpath(path.dirname(entry.original));
      if (parent !== record.root && !inside(record.root, parent)) throw new Error('图片目录已变化，无法安全恢复。');
      await fs.copyFile(entry.backup, entry.original, constants.COPYFILE_EXCL);
    }
    await forget(projectRoot, token);
    return { count: record.entries.length };
  }
  return { trash, restore, forget };
}
module.exports = { createProjectAssetTrash };
