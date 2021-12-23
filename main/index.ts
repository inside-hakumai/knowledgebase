import electron from 'electron'
import path from 'path'
import * as fs from 'fs/promises'
import { marked } from 'marked'
import { parse as parseHtml } from 'node-html-parser'
import log from 'electron-log'

const { BrowserWindow, app, screen, ipcMain, Tray, Menu, globalShortcut } = electron

const isDevelopment = !app.isPackaged

// 通知領域に表示させるアイコンの画像のパス
let treyIconPath: string

if (isDevelopment) {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, '../node_modules', '.bin', 'electron'),
    forceHardReset: true,
    hardResetMethod: 'exit',
  })

  treyIconPath = path.join(__dirname, '..', 'assets', 'icon.png')
} else {
  Object.assign(console, log.functions)
  treyIconPath = path.join(process.resourcesPath, 'assets', 'icon.png')
}

let mainWindow: Electron.BrowserWindow
let tray: electron.Tray | null = null
let suggestItems: { title: string; contents: string }[] = []

app.whenReady().then(async () => {
  await prepareUserData()

  // 本番環境かつMacOSでの起動時、Dockにアイコンを表示させない
  if (app.isPackaged && process.platform === 'darwin') {
    app.dock.hide()
  }

  // 通知領域に表示させるアイコンの設定
  tray = new Tray(treyIconPath)
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Toggle Knowledgebase', click: toggleWindow },
    { label: 'Quit', role: 'quit' },
  ])
  tray.setContextMenu(contextMenu)

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  mainWindow = new BrowserWindow({
    width: 800,
    height: 94,
    resizable: false,
    transparent: true,
    frame: false,
    maximizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.setPosition(Math.floor((width - 600) / 2), 200)

  if (isDevelopment) {
    mainWindow.webContents.openDevTools({ mode: 'detach', activate: false })
  }

  globalShortcut.register('Alt+Command+Space', () => {
    toggleWindow()
  })

  await mainWindow.loadFile('build/index.html')

  app.on('browser-window-blur', () => {
    if (mainWindow.isVisible()) {
      hideWindow()
    }
  })
})

process.on('uncaughtException', (error) => {
  log.error(error)
  app.quit()
})

const toggleWindow = () => {
  if (mainWindow.isVisible()) {
    hideWindow()
  } else {
    showWindow()
  }
}

const hideWindow = () => {
  mainWindow.hide()
  mainWindow.webContents.send('doneDeactivate')
}

const showWindow = () => {
  mainWindow.show()
}

ipcMain.handle('requestSearch', (event, query: string) => {
  console.debug(`RECEIVE MESSAGE: requestSearch, QUERY: ${query}`)

  // ここに検索処理を書く

  mainWindow.setSize(800, 752)
  // event.reply('responseSearch', sampleSuggestItems)
  mainWindow.webContents.send('responseSearch', suggestItems)
})

ipcMain.handle('clearSearch', (event) => {
  console.debug('RECEIVE MESSAGE: clearSearch')
  mainWindow.setSize(800, 94)
})

ipcMain.handle('requestDeactivate', () => {
  console.debug('RECEIVE MESSAGE: requestDeactivate')
  hideWindow()
})

const prepareUserData = async () => {
  const userDataDir = app.getPath('userData')
  const knowledgeDir = path.join(userDataDir, 'knowledge')

  await ensureDirectoryExists(knowledgeDir)

  const files = await fs.readdir(knowledgeDir, { withFileTypes: true })
  const markdownFiles = files.filter((file) => file.isFile() && file.name.endsWith('.md'))

  suggestItems = await Promise.all(
    markdownFiles.map(async (mdFile) => {
      const fileText = await fs.readFile(path.join(knowledgeDir, mdFile.name), 'utf8')
      const parsedMd = marked.parse(fileText)
      const parsedHtml = parseHtml(parsedMd)
      return {
        title: parsedHtml.getElementsByTagName('h1')[0].text,
        contents: fileText,
      }
    })
  )
}

const ensureDirectoryExists = async (dirPath: string) => {
  let isFile = false

  try {
    const stat = await fs.stat(dirPath)
    if (stat.isFile()) {
      isFile = true
    }
  } catch (error) {
    await fs.mkdir(dirPath)
  }

  if (isFile) {
    throw new Error('Specified path is file path')
  }
}
