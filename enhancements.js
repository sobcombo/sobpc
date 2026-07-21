(function(){
    "use strict";

    const QUEUE_KEY = "sobSyncQueue";
    const USER_DATA_PREFIX = "sobDataByUser";
    const OCR_SCRIPT =
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

    let ocrTimer = null;
    let ocrBusy = false;
    let ocrCanvas = null;
    let ocrContext = null;
    let ocrVideo = null;
    let usernameChangeTimer = null;

    const originalPostToCloud = window.postToCloud;
    const originalPrintAllA4 = window.printAllA4;
    const originalPrint80mm = window.print80mm;

    function normalizeUser(value){
        return String(value || "").trim().toLowerCase();
    }

    function currentUser(){
        return usernameInput.value.trim();
    }

    function localUserKey(){
        return [
            USER_DATA_PREFIX,
            todayString(),
            normalizeUser(currentUser()) || "__guest__"
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

    function readQueue(){
        const queue = readJson(QUEUE_KEY,[]);
        return Array.isArray(queue) ? queue : [];
    }

    function writeQueue(queue){
        localStorage.setItem(QUEUE_KEY,JSON.stringify(queue));
    }

    function queueKey(payload){
        return [
            payload.action || "CREATE",
            payload.date || "",
            payload.entryId || "",
            payload.sob || "",
            payload.displayName || ""
        ].join("|");
    }

    function queuePayload(payload){
        const queue = readQueue();
        const key = queueKey(payload);

        if(!queue.some(item => item.key === key)){
            queue.push({
                key,
                payload,
                addedAt:Date.now()
            });

            writeQueue(queue);
        }

        setCloudStatus("offline");
    }

    function removeQueuedPayload(payload){
        const key = queueKey(payload);

        writeQueue(
            readQueue().filter(item => item.key !== key)
        );
    }

    function saveLocalUserData(){
        const value = Array.isArray(data) ? data : [];

        localStorage.setItem(
            localUserKey(),
            JSON.stringify(value)
        );

        /*
         * Keep the old key for compatibility with the existing page.
         * It now contains only the currently selected user's data.
         */
        localStorage.setItem("sobData",JSON.stringify(value));
        localStorage.setItem("sobDataBackup",JSON.stringify(value));
    }

    function loadLocalUserData(){
        const saved = readJson(localUserKey(),null);

        if(Array.isArray(saved)){
            data = saved;
            return true;
        }

        /*
         * Migrate old local data only once for the current username.
         */
        const oldData = readJson("sobData",null);

        if(
            !localStorage.getItem(localUserKey()) &&
            Array.isArray(oldData) &&
            currentUser()
        ){
            data = oldData;
            saveLocalUserData();
            return true;
        }

        data = [];
        saveLocalUserData();
        return false;
    }

    function mergeRows(localRows,cloudRows){
        const merged = [];
        const keys = new Set();

        [...localRows,...cloudRows].forEach(row => {
            const key = row.entryId || row.sob;

            if(!key || keys.has(key)){
                return;
            }

            keys.add(key);
            merged.push(row);
        });

        return merged;
    }

    function normalizeSob(value){
        const text = String(value || "")
            .toUpperCase()
            .replace(/[\s-]+/g,"");

        const match = text.match(/SOB0*([0-9]{6})(?![0-9])/);

        if(!match){
            return "";
        }

        const number = Number(match[1]);

        return number >= 100000 && number <= 999999
            ? match[1]
            : "";
    }

    function sobFull(value){
        return "SOB000" + value;
    }

    function validPassengerCount(adultValue,childValue){
        const adultCount = Number(adultValue);
        const childCount = Number(childValue);

        if(
            !Number.isInteger(adultCount) ||
            !Number.isInteger(childCount) ||
            adultCount < 0 ||
            childCount < 0 ||
            adultCount > 100 ||
            childCount > 100
        ){
            alert("Adults and children must be between 0 and 100.");
            return false;
        }

        if(adultCount + childCount < 1){
            alert("Enter at least one adult or one child.");
            return false;
        }

        return true;
    }

    function showSavedPopup(){
        let popup = document.getElementById("scanSavedPopup");

        if(!popup){
            popup = document.createElement("div");
            popup.id = "scanSavedPopup";
            popup.textContent = "✓ Saved!";

            document.body.appendChild(popup);
        }

        popup.classList.add("show");

        setTimeout(() => {
            popup.classList.remove("show");
        },700);
    }

    function injectFixStyles(){
        if(document.getElementById("requestedFixStyles")){
            return;
        }

        const style = document.createElement("style");
        style.id = "requestedFixStyles";

        style.textContent = `
            #scanSavedPopup{
                position:fixed;
                top:50%;
                left:50%;
                z-index:100002;
                padding:12px 22px;
                border-radius:28px;
                color:#fff;
                background:#00a83b;
                font-size:18px;
                font-weight:bold;
                box-shadow:0 6px 25px #0006;
                opacity:0;
                pointer-events:none;
                transform:translate(-50%,-50%) scale(.7);
                transition:.18s ease;
            }

            #scanSavedPopup.show{
                opacity:1;
                transform:translate(-50%,-50%) scale(1);
            }

            #ocrHighlight{
                position:fixed;
                z-index:100001;
                display:none;
                border:3px solid #00e676;
                border-radius:8px;
                box-shadow:0 0 0 9999px #0003,0 0 18px #00e676;
                pointer-events:none;
            }

            .print-dropdown{
                width:max-content!important;
                min-width:100px!important;
                max-width:calc(100vw - 20px)!important;
            }

            .print-user-list{
                width:max-content;
                min-width:100%;
            }

            .print-user-item{
                width:max-content;
                max-width:calc(100vw - 40px);
                white-space:nowrap;
            }

            body.dark .print-split,
            body.dark .print-split button{
                box-shadow:4px 4px 0 #111,6px 8px 14px #0007!important;
            }

            @media print{
                .header-left{
                    display:none!important;
                }
            }
        `;

        document.head.appendChild(style);

        const highlight = document.createElement("div");
        highlight.id = "ocrHighlight";
        document.body.appendChild(highlight);
    }

    function setScanHighlight(box){
        const highlight = document.getElementById("ocrHighlight");

        if(!highlight){
            return;
        }

        if(!box){
            highlight.style.display = "block";
            highlight.style.left = "5%";
            highlight.style.top = "20%";
            highlight.style.width = "90%";
            highlight.style.height = "60%";
            return;
        }

        highlight.style.display = "block";
        highlight.style.left = box.left + "px";
        highlight.style.top = box.top + "px";
        highlight.style.width = box.width + "px";
        highlight.style.height = box.height + "px";
    }

    function hideScanHighlight(){
        const highlight = document.getElementById("ocrHighlight");

        if(highlight){
            highlight.style.display = "none";
        }
    }

    function removeQueueItemAfterResponse(payload,response){
        if(
            response &&
            (
                response.status === "success" ||
                response.status === "deleted" ||
                response.status === "duplicate"
            )
        ){
            removeQueuedPayload(payload);
        }
    }

    /*
     * All normal cloud requests are queued if the request fails.
     */
    window.postToCloud = function(payload){
        return originalPostToCloud(payload)
            .then(response => {
                removeQueueItemAfterResponse(payload,response);
                return response;
            })
            .catch(error => {
                queuePayload(payload);
                throw error;
            });
    };

    window.syncOfflineQueue = async function(){
        if(!navigator.onLine){
            setCloudStatus("offline");
            return;
        }

        const queue = readQueue();

        if(!queue.length){
            setCloudStatus("success");
            return;
        }

        setCloudStatus("syncing");

        for(const item of queue){
            try{
                const response = await originalPostToCloud(item.payload);

                if(
                    response.status === "success" ||
                    response.status === "deleted" ||
                    response.status === "duplicate"
                ){
                    removeQueuedPayload(item.payload);
                }else{
                    setCloudStatus("offline");
                    return;
                }
            }catch(error){
                setCloudStatus("offline");
                return;
            }
        }

        setCloudStatus("success");

        /*
         * Refresh the selected user's preview after queued saves sync.
         */
        if(currentUser()){
            window.restoreTodayData();
        }
    };

    /*
     * Save data under the selected username instead of one shared local key.
     */
    window.saveLocalData = saveLocalUserData;

    window.restoreTodayData = async function(){
        const username = currentUser();

        if(!username){
            data = [];
            saveLocalUserData();
            render();
            alert("Enter Username first.");
            return;
        }

        loadLocalUserData();
        render();

        if(!navigator.onLine){
            setCloudStatus("offline");
            return;
        }

        try{
            setCloudStatus("syncing");

            const response = await fetch(
                APP_SCRIPT_URL +
                "?date=" + encodeURIComponent(todayString()) +
                "&displayName=" + encodeURIComponent(username)
            );

            const rows = await response.json();

            if(rows.status === "error"){
                throw new Error(rows.message || "Unable to load data.");
            }

            const cloudRows = Array.isArray(rows) ? rows : [];

            data = mergeRows(data,cloudRows);
            saveLocalUserData();
            render();
            setCloudStatus("success");
        }catch(error){
            console.error(error);
            setCloudStatus("offline");
        }
    };

    /*
     * Change the visible preview immediately when the username changes.
     */
    usernameInput.addEventListener("input",() => {
        clearTimeout(usernameChangeTimer);

        usernameChangeTimer = setTimeout(() => {
            loadLocalUserData();
            render();

            if(currentUser()){
                window.restoreTodayData();
            }
        },250);
    });

    /*
     * Replaces saveEntry with complete validation and a live duplicate check.
     */
    window.saveEntry = async function(){
        const rawInput = sobInput.value.trim();
        const sobNumber = normalizeSob(rawInput);
        const username = currentUser();

        if(!username){
            alert("Enter Username first.");
            usernameInput.focus();
            return;
        }

        if(!/^[0-9]{6}$/.test(rawInput) && !sobNumber){
            alert("Enter a valid SOB ID from 100000 to 999999.");
            return;
        }

        const sixDigits = sobNumber || rawInput;
        const numericSob = Number(sixDigits);

        if(numericSob < 100000 || numericSob > 999999){
            alert("SOB ID must be from 100000 to 999999.");
            return;
        }

        if(!combo.value){
            alert("Select a combo.");
            return;
        }

        if(!validPassengerCount(adults.value || 0,children.value || 0)){
            return;
        }

        const sob = sobFull(sixDigits);

        if(data.some(row => row.sob === sob)){
            alert(sob + " is already saved by " + username + ".");
            return;
        }

        /*
         * Check the whole sheet before saving. If offline, continue locally
         * and let the queue synchronize later.
         */
        if(navigator.onLine){
            try{
                const response = await fetch(
                    APP_SCRIPT_URL +
                    "?date=" + encodeURIComponent(todayString()) +
                    "&all=true"
                );

                const rows = await response.json();

                if(Array.isArray(rows)){
                    const duplicate = rows.find(row =>
                        String(row.sob || "").toUpperCase() === sob
                    );

                    if(duplicate){
                        alert(
                            sob +
                            " has already been saved by " +
                            (duplicate.displayName || "another user") +
                            "."
                        );
                        return;
                    }
                }
            }catch(error){
                setCloudStatus("offline");
            }
        }

        const result = calc();
        const comboName = combo.options[combo.selectedIndex].text;
        const adultCount = Number(adults.value) || 0;
        const childCount = Number(children.value) || 0;

        const entry = {
            entryId:
                typeof crypto !== "undefined" &&
                typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : "ENTRY-" + Date.now() + "-" +
                      Math.random().toString(36).slice(2),
            deviceId,
            displayName:username,
            sob,
            ...result,
            comboName,
            adults:adultCount,
            children:childCount,
            breakup:getVendorBreakup(
                comboName,
                adultCount + childCount
            ),
            time:timeString()
        };

        data.push(entry);
        saveLocalUserData();
        render();

        sobInput.value = "";
        localStorage.setItem("username",username);

        const payload = {
            date:todayString(),
            ...entry
        };

        try{
            const response = await originalPostToCloud(payload);

            if(response.status === "success"){
                removeQueuedPayload(payload);
                setCloudStatus("success");

                if(window.__scanSavePending){
                    window.__scanSavePending = false;
                    showSavedPopup();
                }
            }else if(response.status === "duplicate"){
                data = data.filter(row => row.entryId !== entry.entryId);
                saveLocalUserData();
                render();

                alert(
                    response.message ||
                    sob + " is already saved by another user."
                );
            }else{
                queuePayload(payload);

                if(window.__scanSavePending){
                    window.__scanSavePending = false;
                    showSavedPopup();
                }
            }
        }catch(error){
            queuePayload(payload);

            if(window.__scanSavePending){
                window.__scanSavePending = false;
                showSavedPopup();
            }else{
                alert(
                    "Network unavailable. Data was saved offline and queued."
                );
            }
        }
    };

    /*
     * Strict edit validation.
     */
    window.saveEdit = async function(){
        if(editingIndex < 0){
            return;
        }

        const raw = editSob.value.trim();
        const sobNumber = normalizeSob(raw);

        if(!/^[0-9]{6}$/.test(raw) && !sobNumber){
            alert("Enter a valid SOB ID from 100000 to 999999.");
            return;
        }

        const sixDigits = sobNumber || raw;
        const numericSob = Number(sixDigits);

        if(numericSob < 100000 || numericSob > 999999){
            alert("SOB ID must be from 100000 to 999999.");
            return;
        }

        if(!validPassengerCount(editAdults.value,editChildren.value)){
            return;
        }

        const sob = sobFull(sixDigits);

        if(data.some((row,index) =>
            index !== editingIndex && row.sob === sob
        )){
            alert(sob + " is already saved.");
            return;
        }

        const comboValue = editCombo.value;

        if(!comboValue){
            alert("Select a combo.");
            return;
        }

        const comboName = editCombo.options[
            editCombo.selectedIndex
        ].text;

        const adultCount = Number(editAdults.value);
        const childCount = Number(editChildren.value);
        const values = comboValue.split(",");

        const result = {
            tpu:adultCount * Number(values[0]) +
                childCount * Number(values[1]),
            oepl:(adultCount + childCount) * Number(values[2]),
            paepl:(adultCount + childCount) * Number(values[3])
        };

        result.total = result.tpu + result.oepl + result.paepl;

        const updatedRow = {
            ...data[editingIndex],
            sob,
            comboName,
            adults:adultCount,
            children:childCount,
            ...result,
            breakup:getVendorBreakup(
                comboName,
                adultCount + childCount
            ),
            time:
                editHour.value +
                ":" +
                editMinute.value +
                " " +
                editAmPm.value
        };

        data[editingIndex] = updatedRow;
        saveLocalUserData();
        render();
        closeEditModal();

        const payload = {
            action:"UPDATE",
            date:todayString(),
            ...updatedRow,
            deviceId
        };

        try{
            const response = await originalPostToCloud(payload);

            if(response.status === "success"){
                removeQueuedPayload(payload);
                setCloudStatus("success");
            }else{
                queuePayload(payload);
            }
        }catch(error){
            queuePayload(payload);
        }
    };

    /*
     * Reset only the selected username.
     */
    window.resetAllData = async function(){
        const username = currentUser();

        if(!username){
            alert("Enter or select a username first.");
            usernameInput.focus();
            return;
        }

        if(!data.length){
            alert("There is no data for the selected user.");
            return;
        }

        if(!confirm("Reset today's data for " + username + "?")){
            return;
        }

        const payload = {
            action:"RESET",
            date:todayString(),
            displayName:username,
            deviceId
        };

        data = [];
        saveLocalUserData();
        render();

        try{
            const response = await originalPostToCloud(payload);

            if(response.status !== "success"){
                throw new Error(response.message || "Reset failed.");
            }

            removeQueuedPayload(payload);
            setCloudStatus("success");
        }catch(error){
            queuePayload(payload);
            alert("Reset saved offline and will sync when online.");
        }
    };

    /*
     * Full-screen QR scanning. No qrbox means the entire camera preview
     * can be used for QR detection.
     */
    window.startScanner = function(){
        scannerOverlay.classList.add("show");

        uploadQrInput.removeAttribute("capture");
        uploadQrInput.setAttribute("accept","image/*");

        if(qrScanner){
            qrScanner.stop()
                .catch(() => {})
                .finally(() => {
                    qrScanner = null;
                    initFullScreenScanner();
                });
        }else{
            initFullScreenScanner();
        }

        startOcr();
    };

    function initFullScreenScanner(){
        if(typeof Html5Qrcode === "undefined"){
            alert("QR scanner library is still loading.");
            closeScanner();
            return;
        }

        qrScanner = new Html5Qrcode("reader");

        qrScanner.start(
            {facingMode:"environment"},
            {
                fps:15,
                qrbox:false,
                aspectRatio:1.7777778
            },
            decodedText => {
                const sob = normalizeSob(decodedText);

                if(sob){
                    window.__scanSavePending = true;
                    sobInput.value = sob;
                    showSavedPopup();
                    closeScanner();
                    setTimeout(saveEntry,220);
                }
            },
            () => {}
        ).catch(error => {
            console.error(error);
            alert("Camera could not start.");
            closeScanner();
        });
    }

    /*
     * Remove capture=environment so mobile browsers open the gallery.
     */
    window.uploadQrImage = function(){
        uploadQrInput.removeAttribute("capture");
        uploadQrInput.setAttribute("accept","image/*");
        uploadQrInput.click();
    };

    window.handleQrUpload = async function(event){
        const file = event.target.files && event.target.files[0];

        if(!file){
            return;
        }

        try{
            const result = await Html5Qrcode.scanFile(file,true);
            const sob = normalizeSob(result);

            if(!sob){
                alert("No valid SOB ID from 100000 to 999999 was found.");
                return;
            }

            window.__scanSavePending = true;
            sobInput.value = sob;
            showSavedPopup();
            closeScanner();
            setTimeout(saveEntry,220);
        }catch(error){
            alert("No QR code found in the selected image.");
        }

        event.target.value = "";
    };

    function loadTesseract(){
        return new Promise((resolve,reject) => {
            if(window.Tesseract){
                resolve();
                return;
            }

            const script = document.createElement("script");
            script.src = OCR_SCRIPT;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async function startOcr(){
        try{
            await loadTesseract();

            ocrVideo = document.querySelector("#reader video");

            if(!ocrVideo){
                setTimeout(startOcr,700);
                return;
            }

            if(!ocrCanvas){
                ocrCanvas = document.createElement("canvas");
                ocrCanvas.style.display = "none";
                document.body.appendChild(ocrCanvas);
                ocrContext = ocrCanvas.getContext("2d",{
                    willReadFrequently:true
                });
            }

            if(ocrTimer){
                clearInterval(ocrTimer);
            }

            ocrTimer = setInterval(scanOcrFrame,1800);
        }catch(error){
            console.warn("OCR library could not load:",error);
        }
    }

    async function scanOcrFrame(){
        if(
            ocrBusy ||
            !ocrVideo ||
            ocrVideo.readyState < 2 ||
            !scannerOverlay.classList.contains("show")
        ){
            return;
        }

        ocrBusy = true;

        try{
            const width = ocrVideo.videoWidth;
            const height = ocrVideo.videoHeight;

            if(!width || !height){
                ocrBusy = false;
                return;
            }

            ocrCanvas.width = width;
            ocrCanvas.height = height;

            ocrContext.drawImage(
                ocrVideo,
                0,
                0,
                width,
                height
            );

            const result = await Tesseract.recognize(
                ocrCanvas,
                "eng",
                {
                    logger:() => {}
                }
            );

            const fullText = String(result.data.text || "")
                .replace(/\s+/g," ");

            const sob = normalizeSob(fullText);

            if(!sob){
                ocrBusy = false;
                return;
            }

            const words = result.data.words || [];
            const matchingWords = words.filter(word =>
                /SOB|[0-9]{3,}/i.test(word.text || "")
            );

            let box = null;

            matchingWords.forEach(word => {
                if(!word.bbox){
                    return;
                }

                const rect = word.bbox;

                if(!box){
                    box = {
                        x0:rect.x0,
                        y0:rect.y0,
                        x1:rect.x1,
                        y1:rect.y1
                    };
                }else{
                    box.x0 = Math.min(box.x0,rect.x0);
                    box.y0 = Math.min(box.y0,rect.y0);
                    box.x1 = Math.max(box.x1,rect.x1);
                    box.y1 = Math.max(box.y1,rect.y1);
                }
            });

            const videoRect = ocrVideo.getBoundingClientRect();

            if(box){
                const scaleX = videoRect.width / width;
                const scaleY = videoRect.height / height;

                setScanHighlight({
                    left:videoRect.left + box.x0 * scaleX,
                    top:videoRect.top + box.y0 * scaleY,
                    width:(box.x1 - box.x0) * scaleX,
                    height:(box.y1 - box.y0) * scaleY
                });
            }else{
                setScanHighlight(null);
            }

            window.__scanSavePending = true;
            sobInput.value = sob;
            showSavedPopup();

            clearInterval(ocrTimer);
            ocrTimer = null;

            setTimeout(() => {
                closeScanner();
                saveEntry();
            },220);
        }catch(error){
            console.warn("OCR scan failed:",error);
        }

        ocrBusy = false;
    }

    const originalCloseScanner = window.closeScanner;

    window.closeScanner = function(){
        if(ocrTimer){
            clearInterval(ocrTimer);
            ocrTimer = null;
        }

        hideScanHighlight();
        originalCloseScanner();
    };

    /*
     * Remove POS# from print windows, including the 80mm receipt.
     */
    const nativeOpen = window.open;

    window.open = function(){
        const win = nativeOpen.apply(window,arguments);

        if(!win || !win.document){
            return win;
        }

        const originalWrite = win.document.write.bind(win.document);

        win.document.write = function(html){
            const cleaned = String(html)
                .replace(/POS#\s*:\s*_*/gi,"")
                .replace(/<b>\s*POS#\s*:\s*<\/b>/gi,"");

            return originalWrite(cleaned);
        };

        return win;
    };

    /*
     * Ensure the currently selected user is loaded on first open.
     */
    injectFixStyles();
    loadLocalUserData();
    render();

    window.addEventListener("online",() => {
        setTimeout(window.syncOfflineQueue,500);
    });

    window.addEventListener("offline",() => {
        setCloudStatus("offline");
    });

    setTimeout(() => {
        if(currentUser()){
            window.restoreTodayData();
        }
    },300);

    window.syncOfflineQueue();

})();
