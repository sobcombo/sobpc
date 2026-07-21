(function(){
    "use strict";

    const TODAY = new Intl.DateTimeFormat("en-GB",{
        timeZone:"Asia/Kolkata",
        day:"2-digit",
        month:"2-digit",
        year:"numeric"
    }).format(new Date());

    const USER_PREFIX = "sobDataByUser";
    const QUEUE_KEY = "sobSyncQueue";

    function userName(){
        const input = document.getElementById("usernameInput");
        return input ? input.value.trim() : "";
    }

    function userKey(){
        return [
            USER_PREFIX,
            TODAY,
            userName().trim().toLowerCase() || "__guest__"
        ].join(":");
    }

    function readJson(key,fallback){
        try{
            const value = JSON.parse(
                localStorage.getItem(key) || ""
            );

            return value;
        }catch(error){
            return fallback;
        }
    }

    /*
     * Prevent yesterday's legacy sobData from being migrated into today.
     * The old shared storage key did not contain a date, so it is unsafe.
     */
    const storageDate = localStorage.getItem("sobDataStorageDate");

    if(storageDate !== TODAY){
        localStorage.removeItem("sobData");
        localStorage.removeItem("sobDataBackup");
        localStorage.setItem("sobDataStorageDate",TODAY);
    }

    function saveCurrentUserData(){
        const rows = Array.isArray(window.data)
            ? window.data
            : [];

        localStorage.setItem(
            userKey(),
            JSON.stringify(rows)
        );

        localStorage.setItem("sobData",JSON.stringify(rows));
        localStorage.setItem("sobDataBackup",JSON.stringify(rows));
        localStorage.setItem("sobDataStorageDate",TODAY);
    }

    function loadCurrentUserData(){
        const saved = readJson(userKey(),[]);

        window.data = Array.isArray(saved)
            ? saved
            : [];

        saveCurrentUserData();

        if(typeof window.render === "function"){
            window.render();
        }
    }

    function addStyles(){
        if(document.getElementById("finalFixStyles")){
            return;
        }

        const style = document.createElement("style");
        style.id = "finalFixStyles";

        style.textContent = `
            /*
             * Long usernames remain in one line and stay centered.
             */
            .header-center{
                justify-content:center!important;
                flex:1 1 0!important;
                min-width:0!important;
            }

            .header-center .headerLine{
                display:inline-block!important;
                width:max-content!important;
                min-width:120px!important;
                max-width:none!important;
                white-space:nowrap!important;
                overflow:visible!important;
                text-align:center!important;
                padding-left:8px!important;
                padding-right:8px!important;
            }

            /*
             * Animated Paytm-style scanner frame.
             * QR and OCR detection still use the complete camera screen.
             */
            #paytmScannerFrame{
                position:fixed;
                top:50%;
                left:50%;
                z-index:100000;
                width:min(78vw,320px);
                height:min(78vw,320px);
                transform:translate(-50%,-50%);
                pointer-events:none;
            }

            #paytmScannerFrame .scan-corner{
                position:absolute;
                width:34px;
                height:34px;
                border-color:#00baf2;
                border-style:solid;
                filter:drop-shadow(0 0 7px #00baf2);
            }

            #paytmScannerFrame .top-left{
                top:0;
                left:0;
                border-width:4px 0 0 4px;
                border-radius:10px 0 0 0;
            }

            #paytmScannerFrame .top-right{
                top:0;
                right:0;
                border-width:4px 4px 0 0;
                border-radius:0 10px 0 0;
            }

            #paytmScannerFrame .bottom-left{
                bottom:0;
                left:0;
                border-width:0 0 4px 4px;
                border-radius:0 0 0 10px;
            }

            #paytmScannerFrame .bottom-right{
                right:0;
                bottom:0;
                border-width:0 4px 4px 0;
                border-radius:0 0 10px 0;
            }

            #paytmScannerFrame .scan-laser{
                position:absolute;
                left:4%;
                width:92%;
                height:4px;
                background:linear-gradient(
                    90deg,
                    transparent,
                    #00baf2,
                    #fff,
                    #00baf2,
                    transparent
                );
                box-shadow:0 0 12px 3px #00baf2;
                animation:paytmScan 2.2s ease-in-out infinite;
            }

            #paytmScannerFrame.detected{
                animation:scannerDetected .35s ease;
            }

            @keyframes paytmScan{
                0%{
                    top:5%;
                    opacity:0;
                }
                10%{
                    opacity:1;
                }
                90%{
                    opacity:1;
                }
                100%{
                    top:95%;
                    opacity:0;
                }
            }

            @keyframes scannerDetected{
                0%{
                    transform:translate(-50%,-50%) scale(1);
                }
                50%{
                    transform:translate(-50%,-50%) scale(1.08);
                    filter:drop-shadow(0 0 20px #00e676);
                }
                100%{
                    transform:translate(-50%,-50%) scale(1);
                }
            }

            /*
             * The print-all page uses this rule as well as the normal A4 page.
             */
            @media print{
                .header-center{
                    justify-content:center!important;
                }

                .header-center .headerLine{
                    width:max-content!important;
                    max-width:none!important;
                    min-width:120px!important;
                    white-space:nowrap!important;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function createScannerFrame(){
        if(document.getElementById("paytmScannerFrame")){
            return;
        }

        const frame = document.createElement("div");
        frame.id = "paytmScannerFrame";

        frame.innerHTML = `
            <div class="scan-corner top-left"></div>
            <div class="scan-corner top-right"></div>
            <div class="scan-corner bottom-left"></div>
            <div class="scan-corner bottom-right"></div>
            <div class="scan-laser"></div>
        `;

        document.getElementById("scannerOverlay")
            .appendChild(frame);
    }

    function markDetected(){
        const frame = document.getElementById("paytmScannerFrame");

        if(!frame){
            return;
        }

        frame.classList.remove("detected");
        void frame.offsetWidth;
        frame.classList.add("detected");
    }

    function normalizeSob(value){
        const text = String(value || "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g,"");

        let match = text.match(/SOB0*([0-9]{6})(?![0-9])/);

        if(!match && /^[0-9]{6}$/.test(text)){
            match = [text,text];
        }

        if(!match){
            return "";
        }

        const number = Number(match[1]);

        return number >= 100000 && number <= 999999
            ? match[1]
            : "";
    }

    function saveScannedSob(value){
        const sob = normalizeSob(value);

        if(!sob){
            return false;
        }

        markDetected();

        const input = document.getElementById("sobInput");
        input.value = sob;

        window.__scanSavePending = true;

        if(typeof window.showSavedPopup === "function"){
            window.showSavedPopup();
        }

        if(typeof window.closeScanner === "function"){
            window.closeScanner();
        }

        setTimeout(() => {
            if(typeof window.saveEntry === "function"){
                window.saveEntry();
            }
        },220);

        return true;
    }

    /*
     * Replace QR scanning callback so SOB000123456 and plain 123456
     * are both accepted.
     */
    window.onScanSuccess = function(decodedText){
        saveScannedSob(decodedText);
    };

    /*
     * Use the whole camera screen. The square is only a visual guide;
     * the decoder receives the complete camera frame.
     */
    const oldStartScanner = window.startScanner;

    window.startScanner = function(){
        addStyles();
        createScannerFrame();

        const input = document.getElementById("uploadQrInput");

        if(input){
            input.removeAttribute("capture");
            input.setAttribute("accept","image/*");
        }

        if(typeof oldStartScanner === "function"){
            oldStartScanner();
        }
    };

    /*
     * OCR fallback for printed text or text displayed on a screen.
     */
    async function scanUploadedText(file){
        if(!window.Tesseract){
            await loadTesseract();
        }

        const result = await window.Tesseract.recognize(
            file,
            "eng",
            {
                logger:() => {}
            }
        );

        return result &&
            result.data &&
            result.data.text
            ? result.data.text
            : "";
    }

    function loadTesseract(){
        return new Promise((resolve,reject) => {
            if(window.Tesseract){
                resolve();
                return;
            }

            const script = document.createElement("script");
            script.src =
                "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /*
     * First try QR decoding. If no QR is found, OCR the uploaded image.
     */
    window.handleQrUpload = async function(event){
        const input = event.target;
        const file = input.files && input.files[0];

        if(!file){
            return;
        }

        try{
            let qrText = "";

            if(window.Html5Qrcode){
                try{
                    qrText = await window.Html5Qrcode.scanFile(
                        file,
                        false
                    );
                }catch(firstError){
                    try{
                        qrText = await window.Html5Qrcode.scanFile(
                            file,
                            true
                        );
                    }catch(secondError){
                        qrText = "";
                    }
                }
            }

            if(saveScannedSob(qrText)){
                input.value = "";
                return;
            }

            const ocrText = await scanUploadedText(file);

            if(!saveScannedSob(ocrText)){
                alert(
                    "No valid SOB ID found. Use a clear image containing " +
                    "SOB000123456."
                );
            }
        }catch(error){
            console.error("Uploaded image scan failed:",error);
            alert(
                "Could not read this image. Please use a clear QR or " +
                "SOB000123456 text image."
            );
        }

        input.value = "";
    };

    /*
     * Keep username data isolated while typing a different username.
     */
    function bindUsernameSwitch(){
        const input = document.getElementById("usernameInput");

        if(!input || input.dataset.finalFixBound){
            return;
        }

        input.dataset.finalFixBound = "true";

        let timer;

        input.addEventListener("input",() => {
            clearTimeout(timer);

            timer = setTimeout(() => {
                loadCurrentUserData();

                if(
                    navigator.onLine &&
                    typeof window.restoreTodayData === "function"
                ){
                    window.restoreTodayData();
                }
            },250);
        });
    }

    /*
     * Remove POS# from all generated print documents and improve long-name
     * layout in print-all and 80mm windows.
     */
    function patchPrintWindows(){
        if(window.__finalPrintPatch){
            return;
        }

        window.__finalPrintPatch = true;

        const nativeOpen = window.open;

        window.open = function(){
            const win = nativeOpen.apply(window,arguments);

            if(!win || !win.document){
                return win;
            }

            const originalWrite =
                win.document.write.bind(win.document);

            win.document.write = function(html){
                let output = String(html);

                output = output.replace(
                    /POS#\\s*:\\s*_*\\s*/gi,
                    ""
                );

                output = output.replace(
                    /<span[^>]*>\\s*POS#\\s*:\\s*_*\\s*<\\/span>/gi,
                    ""
                );

                const printFix = `
                    <style>
                        .header-center{
                            justify-content:center!important;
                        }

                        .header-center .headerLine{
                            width:max-content!important;
                            min-width:120px!important;
                            max-width:none!important;
                            white-space:nowrap!important;
                            overflow:visible!important;
                            text-align:center!important;
                        }

                        .headerLine{
                            white-space:nowrap!important;
                        }

                        .header{
                            overflow:visible!important;
                        }

                        .a4Page + .a4Page{
                            page-break-before:always!important;
                            break-before:page!important;
                        }
                    </style>
                `;

                return originalWrite(
                    output.replace("</head>",printFix + "</head>")
                );
            };

            return win;
        };
    }

    addStyles();
    bindUsernameSwitch();
    patchPrintWindows();

    /*
     * If enhancements.js already ran before this file, immediately replace
     * any stale visible data with today's selected-user data.
     */
    if(userName()){
        const saved = readJson(userKey(),null);

        if(Array.isArray(saved)){
            window.data = saved;
        }else{
            window.data = [];
            saveCurrentUserData();
        }

        if(typeof window.render === "function"){
            window.render();
        }
    }

    /*
     * Keep the legacy key date-aware whenever the page saves.
     */
    const oldSaveLocalData = window.saveLocalData;

    window.saveLocalData = function(){
        saveCurrentUserData();

        if(typeof oldSaveLocalData === "function"){
            /*
             * Do not call the old function because it can overwrite the
             * selected user's date-separated data with stale data.
             */
        }
    };

    window.addEventListener("online",() => {
        if(typeof window.syncOfflineQueue === "function"){
            window.syncOfflineQueue();
        }
    });

})();
