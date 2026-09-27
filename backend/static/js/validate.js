/**
 * Валидация имени проекта. Дублирует логику бэкенда,
 * чтобы можно было показать ошибку сразу, без запроса.
 */

const FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1F]/;
const RESERVED_NAMES = new Set([
  "con","prn","aux","nul",
  "com1","com2","com3","com4","com5","com6","com7","com8","com9",
  "lpt1","lpt2","lpt3","lpt4","lpt5","lpt6","lpt7","lpt8","lpt9",
]);

/**
 * Возвращает строку с ошибкой или null, если имя валидно.
 */
export function validateProjectName(name) {
  if (typeof name !== "string") return "Имя должно быть строкой";
  const n = name.trim();
  if (!n) return "Имя не может быть пустым";
  if (n.length > 100) return "Имя длиннее 100 символов";
  if (FORBIDDEN_CHARS.test(n))
    return 'Имя содержит запрещённые символы: < > : " / \\ | ? *';
  if (n === "." || n === "..") return "Недопустимое имя";
  if (n.endsWith(".") || n.endsWith(" "))
    return "Имя не может заканчиваться точкой или пробелом";
  if (RESERVED_NAMES.has(n.toLowerCase()))
    return `Имя «${n}» зарезервировано системой`;
  return null;
}

/**
 * Проверить, что имя не занято другим проектом.
 * @param {string} name - проверяемое имя
 * @param {Array} existingProjects - список из api.projects.list()
 * @param {string|null} excludeName - не учитывать этот проект (для переименования)
 */
export function checkProjectNameAvailable(name, existingProjects, excludeName = null) {
  const lname = name.trim().toLowerCase();
  for (const p of existingProjects) {
    if (excludeName && p.name.toLowerCase() === excludeName.toLowerCase()) continue;
    if (p.name.toLowerCase() === lname) {
      return `Проект «${name}» уже существует`;
    }
  }
  return null;
}
