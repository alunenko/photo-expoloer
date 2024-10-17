cp index.js ../electron/
cp public/index.html ../electron/
cd ../electron/
npm run build
sudo npm run build -- --win
cp dist/MyElectronWebApp\ Setup\ 1.0.0.exe /Users/alef/Public/
cp dist/MyElectronWebApp-1.0.0-arm64.dmg /Users/alef/Public/
