const fs = require('fs');
const path = require('path');

// Создаем структуру директорий
const directories = [
  'src/components/buttons',
  'src/components/modals',
  'src/components/navigation',
  'src/pages',
  'src/services',
  'src/utils',
  'src/styles',
  'src/assets/images',
  'src/assets/fonts',
  'public',
  'tests/unit',
  'tests/integration',
  'tests/e2e',
];

// Функция для создания директорий
function createDirectories() {
  directories.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Создана директория: ${dir}`);
    }
  });
}

// Функция для перемещения файлов
function moveFile(src, dest) {
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest);
    console.log(`Файл перемещен: ${src} -> ${dest}`);
  }
}

// Реорганизация файлов
function reorganizeFiles() {
  // Перемещение script.js в services
  moveFile('script.js', 'src/services/mainService.js');

  // Пример перемещения стилей в styles
  moveFile('styles.css', 'src/styles/global.css');

  // Если есть изображения, переместим их
  if (fs.existsSync('images')) {
    fs.readdirSync('images').forEach((file) => {
      moveFile(path.join('images', file), path.join('src/assets/images', file));
    });
    fs.rmdirSync('images');
  }
}

// Основной процесс
function main() {
  createDirectories();
  reorganizeFiles();
  console.log('Реорганизация завершена.');
}

main();
