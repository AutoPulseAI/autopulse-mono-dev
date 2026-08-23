(function() {
    document.addEventListener("DOMContentLoaded", function() {
        // Create a container for the chatbot widget
        const widgetContainer = document.createElement('div');
        widgetContainer.id = 'chatbot-widget';
        // window.baseurl  = 'https://chat.autopulse.ai/';
        //window.apiurl  = 'https://chat.autopulse.ai/api/vehicle';

        window.baseurl  = 'https://chat.autopulse.ai/';
        window.apiurl  = 'https://chat.autopulse.ai/api/vehicle';
        
        let context = ''; // Initially empty
        let conversation_id = ''; // Initially empty
        // Attach shadow DOM to the widget container
        const shadowRoot = widgetContainer.attachShadow({ mode: 'open' });

        document.body.appendChild(widgetContainer);

        // The base styles and HTML will be injected into the shadow DOM
        const widgetStyles = `
            /* Add your widget-specific styles here */
            @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css');

            @import url('https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css');
          
            @import url('${window.baseurl}assets/css/auto.css');
            @import url('https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.5.0/nouislider.min.css');
            @import url('https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/assets/owl.carousel.min.css');
          
            /* Additional styles for shadow DOM isolation */
            .chatboxAi {
                position: fixed;
                bottom: 0;
                right: 0;
                width: 350px;
                z-index: 99999;
                font-family: Arial, sans-serif;
            }                
            .chatbx_main {
                display: none;
                background-color: #fff;
                box-shadow: 0px 0px 10px rgba(0,0,0,0.1);
            }
            .chatbx_window {
                overflow-y: auto;
                max-height: 400px;
            }

            
            /* Additional widget styles go here */
        `;

        const widgetHtml = `
            <div class="position-relative chatboxAi">
                <div class="chatboxO chatbox_ri">
                    <div class="banner_chatbox_o">
                        <a class="chatboxO_a">
                            <span class="banner_chatbox_text" id="chatbot-name">Ask a question with Autopulse</span>
                            <span class="banner_chatbox_icon">
                                <img src="https://example.com/assets/images/chatbxSearch.png" id="chatbot-logo" alt="chat" class="img-fluid">
                            </span>
                        </a>
                    </div>
                </div>

                <div class="chatbx_main chatbox_ri">
                    <div class="chatbx_secondary chatbx_car_details overflow-hidden">            
                        <div class="chatbx_fulldetail_info chatbxdetails_show" id="chatbx_car_details"></div>
                    </div>

                    <div class="chatbx_primary">
                        <div class="chatbx_head">
                            <img src="https://chat.autopulse.ai/assets/images/auto/auto_ai.png" alt="img" id="chatbot-auto-logo">
                            <a class="full_screen ms-auto"><i class="fa-solid fa-expand"></i></a>
                            <a class="mini_a ms-3"><i class="fa-solid fa-minus"></i></a>
                            <a class="ms-3 chatboxO_a"><i class="fa-solid fa-xmark"></i></a>
                        </div>                  
                        
                        <div class="explore_main" id="explore_main"></div>

                        <div class="chatbx_window">
                            <div class="chatbx_response">
                                <div class="chatbx_msg_l"><small class="welcome_message">Hello, my name is <b>Autopulse</b>, your AI auto concierge. How can I help you?</small></div>
                            </div>
                            <div class="chatbx_msg_loader" id="loader" style="display:none;">
                                <div class="chatbx_msg_l chatbx_msg_loader_inn">
                                    <small>Typing</small><div class="dot-pulse"></div>
                                </div>
                            </div>
                        </div>
                        <div class="chatbx_close_conf" style="display:none;">
                            <div class="chatbx_close_msg">
                                <p><small>Are you sure? this action will delete your previous conversion?</small></p>
                                <div class="chatbx_closemsg_btns">
                                    <a class="btn btn_chatbx chatbx_close_yes">Yes</a>
                                    <a class="btn btn_chatbx chatbx_close_no">No</a>
                                </div>
                            </div>
                        </div>
                        <div class="chatbx_input">
                            <div class="input-group align-items-center flex-nowrap">
                                <input type="text" class="form-control mb-0 border-0" id="userInput" placeholder="Type any questions here...">
                                <a id="sendBtn" class="px-2"><i class="fa-solid fa-paper-plane"></i></a>
                            </div>
                            <small id="charCount" class="text-muted">0/2000</small>
                        </div>
                    </div>
                    <div id="widget_loader-overlay" class="widget_loader_overlay" style="display: none;">
                        <div class="widget_loader"></div>
                    </div>
                </div>
            </div>
        `;

        // Inject CSS and HTML into shadow root
        shadowRoot.innerHTML = `
            <style>${widgetStyles}</style>
            ${widgetHtml}
        `;

        // Load external scripts inside shadow DOM
        function loadScript(url, callback) {
            const script = document.createElement('script');
            script.src = url;
            script.onload = callback;
            shadowRoot.appendChild(script);
        }

        function createLightboxContainer() {
            const lightboxContainer = document.createElement('div');
            lightboxContainer.id = 'shadow-lightbox';
            lightboxContainer.style.display = 'none'; // Initially hidden
        
            // Add lightbox HTML and styling
            lightboxContainer.innerHTML = `
                <style>
                    #shadow-lightbox {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0, 0, 0, 0.8);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        z-index: 100000;
                    }
                    #lightbox-overlay {
                        position: relative;
                        max-width: 80%;
                        max-height: 80%;
                    }
                    #lightbox-image {
                        width: 100%;
                        height: auto;
                        max-width: 100%;
                        max-height: 100%;
                    }
                    #lightbox-close {
                        position: absolute;
                        top: 10px;
                        right: 20px;
                        color: white;
                        font-size: 2rem;
                        cursor: pointer;
                    }
                    .lightbox-nav {
                        position: absolute;
                        top: 50%;
                        transform: translateY(-50%);
                        color: white;
                        font-size: 2rem;
                        cursor: pointer;
                        user-select: none;
                    }
                    #lightbox-prev {
                        left: 10px;
                    }
                    #lightbox-next {
                        right: 10px;
                    }
                </style>
                <div id="lightbox-overlay">
                    <span id="lightbox-close">&times;</span>
                    <span id="lightbox-prev" class="lightbox-nav">&#10094;</span>
                    <img id="lightbox-image" src="" alt="Lightbox Image" />
                    <span id="lightbox-next" class="lightbox-nav">&#10095;</span>
                </div>
            `;
        
            shadowRoot.appendChild(lightboxContainer);
        }
        function loadCSS(url, callback='') {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            if(callback!=''){
            link.onload = callback;
            }
            document.head.appendChild(link);
        }

        function widgetChatbotHeight(shadowRoot) {

            const chatbxMain = shadowRoot.querySelector('.chatbx_main');
            const chatbxPrimary = shadowRoot.querySelector('.chatbx_primary');
            const chatbxHead = shadowRoot.querySelector('.chatbx_head');
            const chatbxInput = shadowRoot.querySelector('.chatbx_input');
            const chatbxWindow = shadowRoot.querySelector('.chatbx_window');
            const exploreMain = shadowRoot.querySelector('.explore_main');
            const chatbxCardCols = shadowRoot.querySelectorAll('.chatbx_card_col');
            const exploreFiltersCol = shadowRoot.querySelector('.explore_filters_col');
            const exploreListCol = shadowRoot.querySelector('.explore_list_col');
        
            if (chatbxMain && chatbxPrimary && chatbxHead && chatbxInput && chatbxWindow && exploreMain) {
                if (!chatbxMain.classList.contains('fullScreen')) {
                    let chatbxWindowHeight = chatbxPrimary.clientHeight - (chatbxHead.clientHeight + chatbxInput.clientHeight);
                    chatbxWindow.style.minHeight = `${chatbxWindowHeight}px`;
                    chatbxWindow.style.maxHeight = `${chatbxWindowHeight}px`;
        
                    let chatbxExploreHeight = chatbxPrimary.clientHeight - chatbxHead.clientHeight;
                    exploreMain.style.minHeight = `${chatbxExploreHeight}px`;
                    exploreMain.style.maxHeight = `${chatbxExploreHeight}px`;
                    exploreMain.style.top = `${chatbxHead.clientHeight}px`;
        
                    chatbxPrimary.style.width = '350px';
                    document.body.style.overflow = 'unset';
        
                    if (chatbxCardCols.length) {
                        chatbxCardCols.forEach(chatbxCardCol => {
                            chatbxCardCol.classList.remove('col-xxxl-4', 'col-xl-6', 'col-lg-6');
                        });
                    }
                    if (exploreFiltersCol) {
                        exploreFiltersCol.classList.remove('col-xxxl-3', 'col-xl-4', 'col-lg-4');
                    }
                    if (exploreListCol) {
                        exploreListCol.classList.remove('col-xxxl-9', 'col-xl-8', 'col-lg-8');
                    }
        
                    chatbxFulldetails(shadowRoot);
        
                } else {
                    let chatbxWindowHeight = window.innerHeight - (chatbxHead.clientHeight + chatbxInput.clientHeight);
                    chatbxWindow.style.minHeight = `${chatbxWindowHeight}px`;
                    chatbxWindow.style.maxHeight = `${chatbxWindowHeight}px`;
        
                    let chatbxExploreHeight = window.innerHeight - chatbxHead.clientHeight;
                    exploreMain.style.minHeight = `${chatbxExploreHeight}px`;
                    exploreMain.style.maxHeight = `${chatbxExploreHeight}px`;
                    chatbxWindow.style.overflowY = 'auto';
                    document.body.style.overflow = 'hidden';
        
                    let primaryWidth;
                    if (window.innerWidth < 991 && window.innerWidth > 600) {
                        primaryWidth = chatbxMain.clientWidth / 1.6;
                    } else if (window.innerWidth < 600) {
                        primaryWidth = chatbxMain.clientWidth;
                    } else {
                        primaryWidth = chatbxMain.clientWidth / 1.525;
                    }
        
                    chatbxPrimary.style.width = `${primaryWidth}px`;
        
                    if (chatbxCardCols.length) {
                        chatbxCardCols.forEach(chatbxCardCol => {
                            chatbxCardCol.classList.add('col-xxxl-4', 'col-xl-6', 'col-lg-6');
                        });
                    }
                    if (exploreFiltersCol) {
                        exploreFiltersCol.classList.add('col-xxxl-3', 'col-xl-4', 'col-lg-4');
                    }
                    if (exploreListCol) {
                        exploreListCol.classList.add('col-xxxl-9', 'col-xl-8', 'col-lg-8');
                    }
        
                    chatbxFulldetails(shadowRoot);
                }
            }
        }
        

        // Initialize chatbot functionality
        function initializeChatbot() {
            //const userId = shadowRoot.querySelector('#chatbot-widget_user')?.getAttribute('data-user-id');
            const scripts = document.querySelectorAll('script[src*="shaddow.js"]');
            let userId = null;

            if (scripts.length > 0) {
                // Get the src of the last matching script (in case there are multiple)
                const scriptSrc = scripts[scripts.length - 1].getAttribute('src');
                const urlParams = new URLSearchParams(scriptSrc.split('?')[1]);
                userId = urlParams.get('userid_id');
            }

            if (!userId) {
                console.error('User ID not found in the script URL.');
                return;
            }
           
            
            console.log(userId);
            // Fetch and apply chatbot settings
            if (userId) {
                fetch(baseurl + 'api/chatbot-settings/' + userId)
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            const primarycolor = data.data.primary_color || '#000000';
                            shadowRoot.querySelector('#chatbot-name').innerText = data.data.chatbot_name || 'Ask a question';
                            shadowRoot.querySelector('#chatbot-logo').src = data.data.icon_logo || '/assets/images/chatbxSearch.png';
                            shadowRoot.querySelector('#chatbot-auto-logo').src = data.data.logo || '/assets/images/chatbxSearch.png';
                            const chatbotIconLogo = data.data.icon_logo || '/assets/images/chatbxSearch.png';
                            const elements = shadowRoot.querySelectorAll('.welcome_message');

                            // Update welcome messages
                            elements.forEach(function(element) {
                                element.innerHTML =data.data.welcome_message  || 'Hello, my name is <b>' + data.data.chatbot_name + '</b>, your AI automotive concierge.';
                            });
                            var position = data.data.position||'right';
                            if (position === 'left') {
                                // If position is left, remove 'chatbox_ri' from chatboxO and chatbx_main
                                var chatboxElements = shadowRoot.querySelectorAll('.chatboxO, .chatbx_main');
                                
                                chatboxElements.forEach(function(element) {
                                    element.classList.remove('chatbox_ri'); // Remove the 'chatbox_ri' class
                                });
                            }

                            // Inject dynamic styles for chatbot logo and primary color
                            const dynamicStyle = document.createElement('style');
                            dynamicStyle.innerHTML = `
                                .chatboxAi .chatbx_response .chatbx_msg_l:before, 
                                .chatboxAi .chatbx_car_card_main:before, 
                                .chatboxAi .chatbx_msg_l.chatbx_msg_loader_inn:before {
                                    content: '';
                                    background: url('${chatbotIconLogo}');
                                    width: 28px;
                                    height: 28px;
                                    background-position: center;
                                    background-repeat: no-repeat;
                                    background-size: cover;
                                    display: block;
                                    position: absolute;
                                    left: -32px;
                                    top: 0;
                                }
                            `;
                            shadowRoot.appendChild(dynamicStyle);

                            // Set custom properties for colors
                            shadowRoot.host.style.setProperty('--chbxprimary', primarycolor);
                            let hexColor = primarycolor;
                            let rgbColor = hexToRgb(hexColor);
                            let alpha = 0.1;
                            let rgbaColor = `rgba(${rgbColor}, ${alpha})`;
                            shadowRoot.host.style.setProperty('--chbxprimary-light', rgbaColor); 
                            shadowRoot.host.style.setProperty('--dark', '#222732');
                            shadowRoot.host.style.setProperty('--dark-light', '#2F3B48');
                            shadowRoot.host.style.setProperty('--gray', '#EFF3FA');
                            shadowRoot.host.style.setProperty('--white', '#ffffff');
                            shadowRoot.host.style.setProperty('--secondary', '#99A1B2');
                        } else {
                            console.error('Failed to load chatbot settings:', data.message);
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching chatbot settings:', error);
                    });
            } else {
                console.error('User ID not found.');
            }
            createLightboxContainer();
            shadowRoot.addEventListener('click', function(event) {
                if (event.target.closest('.chatboxO_a')) {
                    const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                    const chatbxWindow = shadowRoot.querySelector('.chatbx_window');
                    const chatbxCloseConf = shadowRoot.querySelector('.chatbx_close_conf');
                
                    if (chatbxMain.classList.contains('chat_open')) {
                        chatbxWindow.style.overflowY = 'hidden';
                        chatbxMain.classList.remove('collapsed');
                        chatbxCloseConf.style.display = 'block';
                    } else {
                        chatbxMain.classList.add('chat_open');
                    }
                }
            });

           
            
            shadowRoot.querySelector('.chatbx_close_yes').addEventListener('click', function(e) {
                const chatbxWindow = shadowRoot.querySelector('.chatbx_window');
                const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                const chatbxResponse = shadowRoot.querySelector('.chatbx_response');
                const chatbxCloseConf = shadowRoot.querySelector('.chatbx_close_conf');
            
                chatbxCloseConf.style.display = 'none';
                chatbxWindow.style.overflowY = 'auto';
                chatbxMain.classList.remove('chat_open');
                chatbxResponse.innerHTML = `<div class="chatbx_msg_l"><small class="welcome_message">Hello, my name is Autopulse, your AI automotive concierge.</small></div>`;
                
                // Reset conversation variables
                conversation_id = '';
                context = '';
                lastUserInput = '';
                lastFormData = {};
                
                resetchatbx(shadowRoot);
                widgetChatbotHeight(shadowRoot);
            });
            
            shadowRoot.querySelector('.chatbx_close_no').addEventListener('click', function(e) {
                const chatbxWindow = shadowRoot.querySelector('.chatbx_window');
                const chatbxCloseConf = shadowRoot.querySelector('.chatbx_close_conf');
            
                chatbxCloseConf.style.display = 'none';
                chatbxWindow.style.overflowY = 'auto';
            });
            
           
            
            shadowRoot.querySelector('.full_screen').addEventListener('click', function(e) {
                e.preventDefault();
                const chatbxMain = shadowRoot.querySelector('.chatbx_main');
            
                chatbxMain.classList.toggle('fullScreen');
                chatbxListingCars();
                chatbxListingFilter();
                widgetChatbotHeight(shadowRoot);
                initializeCarousel();
            });
            
            shadowRoot.querySelector('.mini_a').addEventListener('click', function(e) {
                e.preventDefault();
                const chatbxMain = shadowRoot.querySelector('.chatbx_main');
            
                if (chatbxMain.classList.contains('chat_open')) {
                    chatbxMain.classList.remove('chat_open');
                } else {
                    chatbxMain.classList.add('chat_open');
                }
            });
            
            shadowRoot.querySelector('#sendBtn').addEventListener('click', function() {
                sendUserMessage();
            });


            

            // Send message on Enter key
            shadowRoot.querySelector('#userInput').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    sendUserMessage();
                }
            });

            // The rest of the initializeChatbot code...

            // Hex to rgb
            function hexToRgb(hex) {
                // Remove the hash (#) if present
                hex = hex.replace(/^#/, '');
            
                // If the hex code is short (e.g., #FFF), convert it to the long form (e.g., #FFFFFF)
                if (hex.length === 4) {
                    hex = hex.split('').map(function (char) {
                        return char + char;
                    }).join('');
                }
            
                // Extract the red, green, and blue components
                var r = parseInt(hex.slice(0, 2), 16);
                var g = parseInt(hex.slice(2, 4), 16);
                var b = parseInt(hex.slice(4, 6), 16);
            
                // Return the RGB values as an object
                return `${r}, ${g}, ${b}`;
            }
            
            function sendUserMessage() {
                const userInput = shadowRoot.querySelector('#userInput').value.trim();
                lastUserInput = userInput; // Store the last user input
            
                if (userInput === '') return;
                if (userInput.length > 2000) {
                    alert('Query should not be more than 2000 characters.');
                    return;
                }
            
                // Display user message in chatbox
                shadowRoot.querySelector('.chatbx_response').innerHTML += `<div class="chatbx_msg_r"><small>${userInput}</small><span class="ch_time">${getCurrentTime()}</span></div>`;
                shadowRoot.querySelector('#userInput').value = '';
                shadowRoot.querySelector('#charCount').textContent = '0/2000';
            
                // Show the loader
                shadowRoot.querySelector('#loader').style.display = 'block';
                shadowRoot.querySelector('#sendBtn').classList.add('chatbx_disable');
            
                // Prepare the data to be sent
                const formData = {
                    request: userInput,
                    context: context || '',
                    conversation_id: conversation_id || '',
                    dealerId: userId
                };
            
                // Define the API URL (replace with your actual route)
                const url = window.baseurl + 'api/chat';  // Example API endpoint
            
                // Perform the AJAX request
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                })
                .then(response => response.json())
                .then(data => {
                    // Hide the loader
                    shadowRoot.querySelector('#loader').style.display = 'none';
                    shadowRoot.querySelector('#sendBtn').classList.remove('chatbx_disable');
            
                    if (data) {
                        conversation_id = data.conversation_id;
                        if (data.rawoutput !== 'Thank you for the question. This topic is beyond my training with providing support for automotive shoppers. I suggest using different resources. Are you interested in purchasing a new or pre-owned vehicle?') {
                            context += data.rawoutput;
                        }
            
                        // Parse and display the response in the chatbox
                        const responseText = formatApiResponse(data);
                        let html = data.html || '';

                        let convertedText = responseText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            
                        shadowRoot.querySelector('.chatbx_response').innerHTML += `<div class="chatbx_msg_l"><small>${convertedText}</small><span class="ch_time">${getCurrentTime()}</span></div>`;
            
                        if (html) {
                          
                            let carhtml = `
                                <div class="chatbx_car_card_main">
                                    <div class="owl-carousel owl-theme chatbx_cars_slides circular_nav">${html}</div>
                                    <span class="ch_time">${getCurrentTime()}</span>
                                </div>`;
                            shadowRoot.querySelector('.chatbx_response').innerHTML += carhtml;
            
                            initializeCarousel();
                            shadowRoot.querySelectorAll('.btn_expand').forEach(button => {
                                button.addEventListener('click', function() {
                                    handleExpandButtonClick(button);
                                });
                            });
                            shadowRoot.querySelectorAll('.btn_exploere_more').forEach(button => {
                                button.addEventListener('click', function() {
                                    handleapicall(button);
                                });
                            });
                        }
            
                        // Scroll to the bottom
                        shadowRoot.querySelector('.chatbx_window').scrollTop = shadowRoot.querySelector('.chatbx_window').scrollHeight;
                    } else {
                        displayErrorMessage('Failed to fetch data from the API');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    displayErrorMessage('Error fetching chatbot response');
                });
            }
            function handleapicall(button){
                myapiurl  = ($(button).attr('data_href'));
               
                shadowRoot.apiresult(myapiurl);
            }
            
            function formatApiResponse(response) {
                if (response && response.response) {
                    let data;
                    try {
                        data = JSON.parse(response.response);
                    } catch (e) {
                        console.error('Failed to parse response as JSON:', e);
                        return '<p>' + response.rawoutput + '</p>';
                    }
            
                    if (!data || typeof data !== 'object') {
                        return '<p>' + response.rawoutput + '</p>';
                    }
            
                    let formattedResponse = '';
                    if (data.heading) formattedResponse += `<h5>${data.heading}</h5>`;
                    if (data.subheading) formattedResponse += `<h6>${data.subheading}</h6>`;
                    if (data.paragraphs && data.paragraphs.length > 0) {
                        data.paragraphs.forEach(paragraph => {
                            formattedResponse += `<p>${paragraph}</p>`;
                        });
                    }
                    if (data.list && data.list.length > 0) {
                        formattedResponse += '<ul>';
                        data.list.forEach(item => {
                            formattedResponse += `<li>${item}</li>`;
                        });
                        formattedResponse += '</ul>';
                    }
                    return formattedResponse;
                }
                return response.rawoutput;
            }
            
            function getCurrentTime() {
                const now = new Date();
                return `${now.getHours()}:${(now.getMinutes() < 10 ? '0' : '') + now.getMinutes()}`;
            }

            function displayErrorMessage(message) {
                const chatBoxResponse = shadowRoot.querySelector('.chatbx_response');
                chatBoxResponse.innerHTML += `
                    <div class="chatbx_msg_l">
                        <small>${message}</small><span class="ch_time">${getCurrentTime()}</span>
                        <a id="resendBtn" class="px-2"><i class="fa-solid fa-redo"></i> Resend</a>
                    </div>`;
                chatBoxResponse.scrollTop = chatBoxResponse.scrollHeight;

                shadowRoot.querySelector('#resendBtn').addEventListener('click', function() {
                    resendLastMessage();
                });
            }

            function resendLastMessage() {
                if (lastUserInput !== '') {
                    shadowRoot.querySelector('#userInput').value = lastUserInput;
                    sendUserMessage();
                }
            }

            

            function initializeCarousel() {
                const carousels = shadowRoot.querySelectorAll('.chatbx_cars_slides');
                
                carousels.forEach((carousel) => {
                    // Remove the existing `.owl-nav` and `.owl-dots` before reinitializing the carousel
                    const existingNav = carousel.parentElement.querySelector('.owl-nav');
                    const existingDots = carousel.parentElement.querySelector('.owl-dots');
            
                    if (existingNav) {
                        existingNav.remove(); // Remove previous navigation if it exists
                    }
                    if (existingDots) {
                        existingDots.remove(); // Remove previous dots if they exist
                    }
            
                    // Destroy the existing carousel only if it's initialized
                    if ($(carousel).hasClass('owl-loaded')) {
                        $(carousel).trigger('destroy.owl.carousel');
                    }
            
                    // Define the carousel options
                    const windowWidth = window.innerWidth;
                    let options = {
                        items: 1,
                        loop: false,
                        margin: 10,
                        dots: false,
                        mouseDrag: false,
                        touchDrag: false,
                        nav: true,
                        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
                    };
            
                    // Adjust items based on window width if in full screen
                    const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                    if (chatbxMain && chatbxMain.classList.contains('fullScreen')) {
                        if (windowWidth > 1500) {
                            options.items = 4;
                        } else if (windowWidth > 991) {
                            options.items = 3;
                        } else if (windowWidth > 600) {
                            options.items = 2;
                        } else {
                            options.items = 1;
                            options.mouseDrag = true;
                            options.touchDrag = true;
                        }
                    }
            
                    // Reinitialize the Owl Carousel without duplicates
                    $(carousel).owlCarousel(options);
                });
            }
            
            

           

            // Additional Helper Functions
            function numberWithCommas(x) {
                return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            }

            function handleExpandButtonClick(button) {
                // Parse vehicle data from the button's data attribute
                const vehicle = JSON.parse(button.getAttribute('data_attr'));
        
                organizedFeatures = {};
              
                if (vehicle && vehicle.extra && vehicle.extra.high_value_features) {
                    // Iterate over the keys of high_value_features (e.g., "AT", "STANDARD")
                    Object.keys(vehicle.extra.high_value_features).forEach(key => {
                        // Iterate over each feature in the array associated with the key
                        vehicle.extra.high_value_features[key].forEach(item => {
                            let category = item.category;
                            let description = item.description;
                
                            // Initialize the category array if it doesn't exist
                            if (!organizedFeatures[category]) {
                                organizedFeatures[category] = [];
                            }
                
                            // Append the description to the category array
                            organizedFeatures[category].push(description);
                        });
                    });
                }
              
               // Container for vehicle details
               const container = shadowRoot.getElementById('chatbx_car_details');
           
               // Extract data from the vehicle object
               const image = vehicle?.['media']?.['photo_links']?.[0] ?? '';
               const title = `${vehicle?.['build']?.['year'] ?? ''} ${vehicle?.['build']?.['make'] ?? ''} ${vehicle?.['build']?.['model'] ?? ''}`;
               const location = `${vehicle?.['dealer']?.['city'] ?? ''}, ${vehicle?.['dealer']?.['state'] ?? ''}`;
               const price = vehicle?.['price'] ? `$${Math.floor(vehicle['price']).toLocaleString('en-US')}` : 'N/A';
           
               // Generate HTML for vehicle details
               const vehicleDetailsHtml = `
               <div class="position-relative chatbx_req_info_inn">
                   <div class="chatbx_subhead position-relative py-0 px-0">
                       <a class="ms-auto chatbxfulldetail_show_btn"><i class="fa-solid fa-chevron-down"></i></a>
                   </div>
           
                   <div class="row">
                       <div class="col col-12">
                           <div class="chatbx_detail_full">
                               <div class="position-relative car_details_slider">
                                   <div class="main_slider">
                                       <!-- Favorite and share
                                       <div class="like_share_icon details_like_share">
                                           <div class="form-check fevCheck">
                                               <input type="checkbox" class="form-check-input" id="btn-check_${vehicle['vin']}" onclick="makeFavourite(this,'${vehicle['id']}','${vehicle['vin']}','makeFavouiteRoute')">
                                               <label class="form-check-label" for="btn-check_${vehicle['vin']}"><i class="far fa-heart" id="heart-icon_${vehicle['vin']}"></i></label>
                                           </div>
                                           <div class="share_icon">
                                               <i class="fa-regular fa-share-from-square" onclick="showSharePopup('${vehicle['id']}', '${vehicle['vdp_url']}', '${title}')"></i>
                                           </div>
                                       </div> -->
                                       <!-- All photos -->
                                       <div class="view_all_photos">
                                           <a class="all_photos">All Photos</a>
                                       </div>
                                       <div id="big" class="owl-carousel owl-theme">
                                           ${vehicle['media']['photo_links'].map(photo => `
                                           <div class="item">
                                               <a href="${photo}" data-lightbox="gallery" data-title="${title}">
                                                   <img src="${photo}" alt="">
                                               </a>
                                           </div>`).join('')}
                                       </div>
                                   </div>
       
                                   <div id="thumbs" class="owl-carousel owl-theme thumbnail_imgs">
                                       ${vehicle['media']['photo_links'].map(photo => `
                                       <div class="item">
                                           <img src="${photo}" alt="">
                                       </div>`).join('')}
                                   </div>
                               </div>
           
                                   <div class="car_details_right_top mb-2">
                                       <div class="car_details_right_inn">
                                           <div class="car_details_spec">
                                               <span class="car_year">${vehicle['inventory_type'] ?? 'NA'}</span>
                                               <div class="position-relative">
                                                   <div class="car_loc ms-0 w-100">
                                                       <i class="fa-solid fa-location-dot me-2"></i><span>${location}</span>
                                                   </div>
                                                   ${vehicle['dealer']['call_track_number'] ? `
                                                   <div class="car_loc ms-0 w-100 mt-1">
                                                       <a href="tel:${vehicle['dealer']['call_track_number']}" class="btn btn_blue ms-auto click_call_btn">
                                                           <i class="fa-solid fa-phone me-2"></i><span>${vehicle['dealer']['call_track_number']}</span>
                                                       </a>
                                                   </div>` : ''}
                                               </div>
                                           </div>
                                           <div class="car_title_price_specs">
                                               <h4>${title}</h4>
                                               <div class="car_spec_short">
                                                   <span>${vehicle['miles'] ? numberWithCommas(vehicle['miles']) : 'N/A'} Miles</span>&nbsp;|&nbsp;
                                                   <span>${vehicle['build']['fuel_type'] ?? 'NA'}</span>&nbsp;|&nbsp;
                                                   <span>${vehicle['build']['transmission'] ?? 'NA'}</span>
                                               </div>
                                               <div class="price_sms d-flex align-items-center mb-3">
                                                   <h5 class="mb-0">${price}</h5>
                                                   ${vehicle['dealer']['call_track_sms'] ? `
                                                   <a href="sms:+${vehicle['dealer']['call_track_sms']}&body=${encodeURIComponent(location.href)}" id="share-sms" class="d-md-none btn btn_blue ms-auto">
                                                       <i class="fa-solid fa-comment me-1"></i><span>Text Message</span>
                                                   </a>` : ''}
                                               </div>
                                           </div>
                                            <a href="${vehicle['vdp_url'] ?? ''}?utm_source=Autopulse+&utm_medium=Autopulse&utm_campaign=Autos" target="_blank" class="btn_chatbx_fill w-100">View Dealer Website</a>
                                           <!--a href="javascript:;" class="btn btn_theme w-100" onclick="triggerViewdetail(this, '${vehicle['vin']}')">Request Contact from Dealer</a-->
                                       </div>
                                       <div class="btm_gray">
                                       </div>
                                   </div>
       
                                   <!-- Req dealer info -->
                                   <div class="details_tab_content" id="showhide_reqinfo">
                                       <div class="tab_content_head">
                                           <h3>Request Information</h3>
                                       </div>
                                       <div class="reqdealer_info">
                                           <form action="" id="validaterequest">
                                               <input type="hidden" name="vid" id="vid"  value="${vehicle['vin']}">
                                               <input type="hidden" name="latitude" id="request_latitude" value="">
                                               <input type="hidden" name="longitude" id="request_longitude" value="">
                                               <input type="hidden" name="city" id="request_city" value="">
                                               <input type="hidden" name="country" id="request_country" value="">
                                                <input type="hidden" name="dealerId" id="rqeust_dealerId" value="${userId}">
                                               <div class="row g-2">
                                                   <div class="col col-6">
                                                       <div class="position-relative">
                                                           <input type="text" name="first_name" id="first_name" value="" placeholder="First Name" class="form-control required">
                                                       </div> 
                                                   </div>
                                                   <div class="col col-6">
                                                       <div class="position-relative">
                                                           <input type="text" name="last_name" id="last_name" value="" placeholder="Last Name" class="form-control required">                                            
                                                       </div> 
                                                   </div>
                                                   <div class="col col-12">
                                                       <div class="position-relative">
                                                           <input type="text"  placeholder="Zip code" name="zip_code" id="request_zip_code" class="form-control required">
                                                       </div> 
                                                   </div>
                                                   <div class="col col-12">
                                                       <div class="position-relative">
                                                           <input type="text" name="email"  placeholder="Email"  value="" class="form-control required">
                                                       </div> 
                                                   </div>
                                                   <div class="col col-12">
                                                       <div class="position-relative">
                                                           <input type="text" name ="phone_number" placeholder="Phone" value="" class="form-control required">
                                                           <input type="hidden" name ="vin" placeholder="Phone" value="${vehicle['vin']}" class="form-control required">
                                                       </div> 
                                                   </div>
                                               </div>   
                                               <a class="btn_chatbx_fill w-100 mt-2" id="savereadfrequestBtn">Send</a>                                         
                                             
                                           </form>
                                       </div> 
                                   </div>                           
           
                                   <!-- Tabs -->
                                   <div class="details_info_tabs text-center" id="details_info_tabs">
                                       <a class="overviewtab">Overview</a>
                                       <a class="specificationstab">Specifications</a>
                                       <a class="featurestab">Features</a>
                                       <!--a href="${vehicle['vdp_url'] ?? ''}" target="_blank" class="view_dealerWeb">View Dealer Website</a-->
                                   </div>
           
                                   <!-- Overview Tab Content -->
                                   <div class="details_tab_content details_overview" id="overview">
                                       <div class="tab_content_head">
                                           <h3>Overview</h3>
                                       </div>
                                       <div class="specs_list">
                                           <ul class="row">
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-4 col-md-4 col-6 specs_left">
                                                           <p>VIN</p>
                                                       </div>
                                                       <div class="col col-xl-8 col-md-8 col-6 specs_right">
                                                           <p><span>${vehicle['vin'] ?? 'NA'}</span><i class="fa-regular fa-copy text_primary ms-1 cursor-pointer copyButton" id="copyButton"></i></p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Year</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['year'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Make</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['make'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Model</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['model'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Trim</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['trim'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Engine</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['engine'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Transmission</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['transmission'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Body type</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['body_type'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                           </ul>
                                       </div>
                                   </div>
           
                                   <!-- Specifications Tab Content -->
                                   <div class="details_tab_content details_specs" id="specifications">
                                       <div class="tab_content_head">
                                           <h3>Specifications</h3>
                                       </div>
                                       <div class="specs_list">
                                           <ul class="row">
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Exterior Color</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['exterior_color'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Interior Color</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['interior_color'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Vehicle Type</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['vehicle_type'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Drive Train</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['drivetrain'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Fuel Type</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['fuel_type'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Engine Size</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['engine_size'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Doors</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['doors'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Cylinders</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['cylinders'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Height</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['overall_height'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Length</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['overall_length'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                               <li class="col col-12">
                                                   <div class="row g-0">
                                                       <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                           <p>Width</p>
                                                       </div>
                                                       <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                           <p>${vehicle['build']['overall_width'] ?? 'NA'}</p>
                                                       </div>
                                                   </div>                                
                                               </li>
                                           </ul>
                                       </div>
                                   </div>
           
                                   <!-- Features Tab Content -->
                                   <div class="details_tab_content details_features" id="features">
                                       <div class="tab_content_head">
                                           <h3>Features</h3>
                                       </div>
           
                                       <div class="accordion accordion-flush" id="detailedFeatures">
                                           ${Object.entries(organizedFeatures ?? {}).map(([key, value], i) => `
                                           <div class="accordion-item">
                                               <h2 class="accordion-header" id="${key}-heading">
                                                   <button class="accordion-button ${i !== 0 ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#${key.replace(/&|\s/g, '_')}" aria-expanded="${i === 0}" aria-controls="${key.replace(/&|\s/g, '_')}">
                                                       ${key}
                                                   </button>
                                               </h2>
                                               <div id="${key.replace(/&|\s/g, '_')}" class="accordion-collapse collapse ${i === 0 ? 'show' : ''}" aria-labelledby="${key}-heading" data-bs-parent="#detailedFeatures">
                                                   <div class="accordion-body">
                                                       <div class="features_list">
                                                           <ul class="row">
                                                               ${value.map(item => `
                                                               <li class="col col-12">
                                                                   <div class="feature_inn">
                                                                       <p><i class="fa-regular fa-circle-check me-2"></i>${item}</p>
                                                                   </div>
                                                               </li>`).join('')}
                                                           </ul>
                                                       </div>
                                                   </div>
                                               </div>
                                           </div>`).join('')}
                                       </div>
                                   </div>
                           </div>
                       </div>
                   </div>
               </div>
               `;
            
                // Inject the generated HTML into the container
                container.innerHTML = vehicleDetailsHtml;
            
                // Optionally, initialize any carousels or UI components here
                shadowRoot.querySelector('.chatbx_fulldetail_info').classList.add('chatbxdetails_show');
                chatbxSidebarCollapsed();
                chatbxFulldetails(shadowRoot);
                initializeAccordions();
                initializeLightbox();
              
                setTimeout(function() {
                    initializeOwlCarousel();
                }, 400);
            
                shadowRoot.querySelectorAll('.chatbxfulldetail_show_btn').forEach(button => {
                    button.addEventListener('click', function() {
                        handleCloseButtonClick(shadowRoot);
                    });
                });
                const saveRequestBtn = shadowRoot.getElementById('savereadfrequestBtn');

                // Attach the event listener programmatically
                if (saveRequestBtn) {
                    saveRequestBtn.addEventListener('click', function() {
                        savereadfrequest(shadowRoot);
                    });
                }
            
                // Car Details Page Tabs scroll
                function scrollToElement(selector) {
                    const target = shadowRoot.querySelector(selector);
                    const container = shadowRoot.querySelector('.chatbx_detail_full');
            
                    if (target && container) {
                        container.scrollTo({
                            top: target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop,
                            behavior: 'smooth'
                        });
                    }
                }
            
                let overviewTab = shadowRoot.querySelector('.overviewtab');
                let specificationsTab = shadowRoot.querySelector('.specificationstab');
                let featuresTab = shadowRoot.querySelector('.featurestab');
            
                if (overviewTab) {
                    overviewTab.addEventListener('click', function() {
                        scrollToElement('#overview');
                    });
                }
            
                if (specificationsTab) {
                    specificationsTab.addEventListener('click', function() {
                        scrollToElement('#specifications');
                    });
                }
            
                if (featuresTab) {
                    featuresTab.addEventListener('click', function() {
                        scrollToElement('#features');
                    });
                }
            }

            function initializeAccordions() {
                const accordionButtons = shadowRoot.querySelectorAll('.accordion-button');

                accordionButtons.forEach(button => {
                    button.addEventListener('click', function () {
                        // Get the collapse target
                        const targetId = button.getAttribute('data-bs-target');
                        const collapseElement = shadowRoot.querySelector(targetId);

                        // Toggle the collapse state
                        if (collapseElement.classList.contains('show')) {
                            collapseElement.classList.remove('show');
                            button.classList.add('collapsed');
                        } else {
                            // Collapse other open items if using accordion behavior
                            const parentAccordion = shadowRoot.querySelector(button.getAttribute('data-bs-parent'));
                            if (parentAccordion) {
                                parentAccordion.querySelectorAll('.accordion-collapse.show').forEach(openCollapse => {
                                    openCollapse.classList.remove('show');
                                    parentAccordion.querySelector(`[data-bs-target="#${openCollapse.id}"]`).classList.add('collapsed');
                                });
                            }

                            collapseElement.classList.add('show');
                            button.classList.remove('collapsed');
                        }
                    });
                });
            }
            
            
            function initializeLightbox() {
                const lightboxContainer = shadowRoot.querySelector('#shadow-lightbox');
                const lightboxImage = shadowRoot.querySelector('#lightbox-image');
                const lightboxClose = shadowRoot.querySelector('#lightbox-close');
                const lightboxPrev = shadowRoot.querySelector('#lightbox-prev');
                const lightboxNext = shadowRoot.querySelector('#lightbox-next');
                let currentIndex = 0;
                let images = [];
            
                // Add event listener for image links
                const lightboxLinks = shadowRoot.querySelectorAll('a[data-lightbox]');
                lightboxLinks.forEach((link, index) => {
                    link.addEventListener('click', function(event) {
                        event.preventDefault();
                        images = Array.from(lightboxLinks); // Store all images in the lightbox
                        currentIndex = index;
                        const imageUrl = this.getAttribute('href');
                        if (imageUrl) {
                            lightboxImage.src = imageUrl;
                            lightboxContainer.style.display = 'flex'; // Show the lightbox
                        }
                    });
                });
            
                // Add event listener for closing the lightbox
                lightboxClose.addEventListener('click', function() {
                    lightboxContainer.style.display = 'none';
                });
            
                // Add event listener for navigating to the previous image
                lightboxPrev.addEventListener('click', function() {
                    currentIndex = (currentIndex > 0) ? currentIndex - 1 : images.length - 1;
                    lightboxImage.src = images[currentIndex].getAttribute('href');
                });
            
                // Add event listener for navigating to the next image
                lightboxNext.addEventListener('click', function() {
                    currentIndex = (currentIndex < images.length - 1) ? currentIndex + 1 : 0;
                    lightboxImage.src = images[currentIndex].getAttribute('href');
                });
            
                // Add event listener for clicking outside the image to close the lightbox
                lightboxContainer.addEventListener('click', function(event) {
                    if (event.target === lightboxContainer) {
                        lightboxContainer.style.display = 'none';
                    }
                });
            }

            function initializeOwlCarousel() {
                const bigImage = shadowRoot.querySelector("#big");
                const thumbs = shadowRoot.querySelector("#thumbs");
            
                $(bigImage).owlCarousel({
                    items: 1,
                    slideSpeed: 2000,
                    nav: false,
                    autoplay: false,
                    dots: false,
                    loop: true,
                    responsiveRefreshRate: 200
                }).on("changed.owl.carousel", debounce(syncPosition, 200));
            
                $(thumbs).owlCarousel({
                    items: 5,
                    dots: false,
                    nav: true,
                    navText: ["<i class='fa-solid fa-angle-left'></i>", "<i class='fa-solid fa-angle-right'></i>"],
                    smartSpeed: 200,
                    slideSpeed: 500,
                    slideBy: 4,
                    margin: 5,
                    responsiveRefreshRate: 100,
                    responsiveClass: true,
                    responsive: {
                        0: {
                            items: 3,
                            margin: 6,
                            nav: false
                        },
                        600: {
                            items: 3,
                            margin: 8
                        },
                        1000: {
                            items: 5,
                            margin: 8
                        },
                        1200: {
                            items: 5
                        }
                    }
                }).on("changed.owl.carousel", debounce(syncPosition2, 200));
            
                $(thumbs).on("click", ".owl-item", function(e) {
                    e.preventDefault();
                    const number = $(this).index();
                    $(bigImage).data("owl.carousel").to(number, 300, true);
                });
            }
            var syncedSecondary = true;
            function syncPosition2(el) {
                if (syncedSecondary) {
                    const number = el.item.index;
                    const bigImage = shadowRoot.querySelector("#big");
                    $(bigImage).data("owl.carousel").to(number, 100, true);
                }
            }
            function syncPosition(el) {
                const count = el.item.count - 1;
                let current = Math.round(el.item.index - el.item.count / 2 - 0.5);
            
                if (current < 0) {
                    current = count;
                }
                if (current > count) {
                    current = 0;
                }
            
                const thumbs = shadowRoot.querySelector("#thumbs");
                $(thumbs).find(".owl-item").removeClass("current").eq(current).addClass("current");
            
                const onscreen = $(thumbs).find(".owl-item.active").length - 1;
                const start = $(thumbs).find(".owl-item.active").first().index();
                const end = $(thumbs).find(".owl-item.active").last().index();
            
                if (current > end) {
                    $(thumbs).data("owl.carousel").to(current, 100, true);
                }
                if (current < start) {
                    $(thumbs).data("owl.carousel").to(current - onscreen, 100, true);
                }
            }
            function debounce(func, wait) {
                let timeout;
                return function(...args) {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func.apply(this, args), wait);
                };
            }
            

            // Sidebar Collapse
            function chatbxSidebarCollapsed() {
                const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                if (!chatbxMain.classList.contains('collapsed')) {
                    chatbxMain.classList.add('collapsed');
                } else {
                    chatbxMain.classList.remove('collapsed');
                    chatbxMain.classList.add('collapsed');
                }
            }

            // Listing Cars
            function chatbxListingCars() {
                const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                const exploreMain = shadowRoot.querySelector('.explore_main');

                if (!chatbxMain.classList.contains('fullScreen') && exploreMain.classList.contains('listingCarsOpen')) {
                    setTimeout(function() {
                        exploreMain.style.height = exploreMain.clientHeight + 'px';
                    }, 400);
                }
            }

            // Submit Form Helpers
           
            window.savereadfrequest = function(shadowRoot) {
                const formElement = shadowRoot.getElementById('validaterequest'); // Target only the request form
            
                // First, validate the specific form fields in "validaterequest"
                if (!validateForm(formElement, shadowRoot)) {
                    return; // If validation fails, stop the form submission
                }
            
                // Get zip code from the specific form and fetch lat/long, city, country using Google API
                const zipCode = formElement.querySelector('#request_zip_code').value;
                if (zipCode) {
                    getLatLong(zipCode, function(lat, lng, city, country) {
                        // If lat/long are successfully fetched, update the hidden fields in the specific form
                        formElement.querySelector('#request_latitude').value = lat;
                        formElement.querySelector('#request_longitude').value = lng;
                        formElement.querySelector('#request_city').value = city;
                        formElement.querySelector('#request_country').value = country;
            
                        // After populating lat/long, submit the specific form via fetch
                        submitRequestForm(formElement, shadowRoot);
                    });
                } else {
                    // If no zip code provided, directly submit the specific form
                    submitRequestForm(formElement, shadowRoot);
                }
            };
            
            // Function to validate the form fields in the targeted form
            function validateForm(formElement, shadowRoot) {
                let isValid = true;
                const requiredFields = formElement.querySelectorAll('.required'); // Target only the fields in the specific form
            
                requiredFields.forEach(field => {
                    if (field.value.trim() === '') {
                        isValid = false;
                        field.classList.add('is-invalid'); // Add a class to highlight invalid fields
                    } else {
                        field.classList.remove('is-invalid'); // Remove class if valid
                    }
                });
            
                return isValid;
            }
            
            function submitRequestForm(formElement, shadowRoot){
                const loaderOverlay = shadowRoot.getElementById('widget_loader-overlay');
                loaderOverlay.style.display = "flex";
                const formData = new FormData(formElement); // Only submit the specific form's data
                const url = window.baseurl + 'api/vehicel/adfMail'; // Ensure baseurl is defined
            
                fetch(url, {
                    method: 'POST',
                    body: formData
                })
                .then(response => response.json())
                .then(data => {
                    loaderOverlay.style.display = "none";
                    formElement.style.display = 'none';
            
                    // Show success message below the form
                    showSuccessMessage("Your request has been submitted successfully.", formElement, shadowRoot);
                })
                .catch(error => {
                    console.error('Error submitting form:', error);
                    loaderOverlay.style.display = "none";
                });
            }
            
            function showSuccessMessage(message, formElement, shadowRoot) {
                const messageContainer = document.createElement('div');
                messageContainer.classList.add('alert', 'alert-success'); // Bootstrap classes for success message
                messageContainer.textContent = message;
                
                // Insert the message after the formElement
                formElement.parentNode.insertBefore(messageContainer, formElement.nextSibling);
            
                // Optionally remove the message after some time
                setTimeout(() => {
                    messageContainer.remove();
                }, 5000); // Hide the message after 5 seconds
            }
            
            // Function to get lat/long from Google API
            function getLatLong(zipCode, callback) {
                const apiKey = 'AIzaSyBaVOhSLQc7xrVpxgbuh-jJbxRLbJFqDiA';
                const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${zipCode}&key=${apiKey}`;
    
                fetch(geocodeUrl)
                    .then(response => response.json())
                    .then(data => {
                        if (data.status === 'OK' && data.results.length > 0) {
                            const lat = data.results[0].geometry.location.lat;
                            const lng = data.results[0].geometry.location.lng;
                            const city = data.results[0].address_components.find(component => component.types.includes('locality')).long_name;
                            const country = data.results[0].address_components.find(component => component.types.includes('country')).short_name;
                            callback(lat, lng, city, country);
                        } else {
                            alert('Invalid ZIP code. Please enter a valid ZIP code.');
                        }
                    })
                    .catch(error => {
                        alert('An error occurred while validating the ZIP code. Please try again.');
                    });
            }
            

            shadowRoot.addEventListener('click', function(event) {
                if (event.target.classList.contains('copyButton')) {
                    // Get the text to copy from the previous sibling span
                    const textToCopy = event.target.previousElementSibling.textContent;
            
                    // Create a temporary input to hold the text for copying
                    const tempInput = document.createElement("input");
                    shadowRoot.appendChild(tempInput);
                    tempInput.value = textToCopy;
                    tempInput.select();
                    document.execCommand("copy");
                    shadowRoot.removeChild(tempInput);
            
                    // Show feedback message
                    const message = document.createElement('small');
                    message.id = 'message';
                    message.classList.add('text-success', 'm-0', 'd-block');
                    message.textContent = "Copied to clipboard";
            
                    // Remove any existing message element in the same container to avoid duplicates
                    const existingMessage = event.target.parentNode.querySelector('#message');
                    if (existingMessage) {
                        existingMessage.remove();
                    }
            
                    // Insert the <small> element after the copy button
                    event.target.parentNode.appendChild(message);
            
                    // Set timeout to remove the message after 3 seconds
                    setTimeout(function() {
                        message.remove();
                    }, 3000);
                }
            });
            

            function showSuccessMessage(message, formElement) {
                const messageContainer = document.createElement('div');
                messageContainer.classList.add('alert', 'alert-success');
                messageContainer.textContent = message;
                formElement.parentNode.insertBefore(messageContainer, formElement.nextSibling);
                setTimeout(() => messageContainer.remove(), 5000);
            }

            
            function chatbxListingFilter() {
                // Handle filtering for listing cars
                console.log('Listing filter applied');
            }

            function handleCloseButtonClick(shadowRoot) {
                const chatboxMain = shadowRoot.querySelector('.chatbx_main');
                const chatboxFullDetail = shadowRoot.querySelector('.chatbx_fulldetail_info');
            
                if (chatboxMain) {
                    chatboxMain.classList.remove('collapsed');
                }
            
                if (chatboxFullDetail) {
                    chatboxFullDetail.classList.remove('chatbxdetails_show');
                }
            }

            function resetchatbx(shadowRoot) {
                // Reset overflow of the parent document's body (since shadowRoot doesn't control the parent body)
                document.body.style.overflow = 'unset';
            
                // Access elements inside the shadow DOM and modify classes
                const chatboxMain = shadowRoot.querySelector('.chatbx_main');
                const chatboxReqInfo = shadowRoot.querySelector('.chatbx_req_info');
                const chatboxFullDetail = shadowRoot.querySelector('.chatbx_fulldetail_info');
            
                if (chatboxMain) {
                    chatboxMain.classList.remove('collapsed');
                    chatboxMain.classList.remove('fullScreen');
                }
            
                if (chatboxReqInfo) {
                    chatboxReqInfo.classList.remove('chatbxreq_show');
                }
            
                if (chatboxFullDetail) {
                    chatboxFullDetail.classList.remove('chatbxdetails_show');
                }
            }

           
            function validateAndSubmitForm() {
                // Implement form validation and submission logic
                shadowRoot.submitForm();
            }

            // Event listeners scoped to Shadow DOM
            shadowRoot.addEventListener('click', function(event) {
                if (event.target.closest("input[type='checkbox']") || event.target.closest("select")) {
                    validateAndSubmitForm();
                }
            });

            shadowRoot.addEventListener('change', function(event) {
                if (event.target.id === 'sorting') {
                    let previousSortingValue = shadowRoot.querySelector('#sorting').value;
                    const currentSortingValue = event.target.value;

                    if (currentSortingValue !== previousSortingValue) {
                        previousSortingValue = currentSortingValue;
                        validateAndSubmitForm();
                    }
                }
            });

            shadowRoot.addEventListener('click', function(event) {
                if (event.target.matches('.pagination a')) {
                    event.preventDefault();
                    var url = event.target.href;
                    shadowRoot.apiresult(url);
                }
                if (event.target.matches('.listing_filter_collapse')) {
                    var chatbxWindow = shadowRoot.querySelector('.explore_main');
                    if (chatbxWindow) {
                        
                        chatbxWindow.classList.toggle('listingFilterOpen');
                    }
                    chatbxListingFilter();
                }
                if (event.target.matches('.listing_cars_back')) {
                    var chatbxWindow = shadowRoot.querySelector('.explore_main');
                    if (chatbxWindow) {
                        chatbxWindow.classList.remove('listingCarsOpen');
                    }
                }
            });

            shadowRoot.apiresult = function(url) {
                const loaderOverlay = shadowRoot.getElementById('widget_loader-overlay');
                loaderOverlay.style.display = "flex";
                fetch(url, {
                    method: 'GET',
                })
                .then(response => response.json())
                .then(data => {
                    if (data.html) {
                        // Replace content with new HTML inside shadow DOM
                        shadowRoot.getElementById('explore_main').innerHTML = data.html;
                        // Reinitialize any components or bindings
                        initializeDynamicComponents(shadowRoot);
                        initializeCollapsibleElements();
                        shadowRoot.querySelectorAll('.btn_expand').forEach(button => {
                            button.addEventListener('click', function() {
                                handleExpandButtonClick(button);
                            });
                        });
                        const chatbxWindow = shadowRoot.querySelector('.explore_main');
                        if (chatbxWindow) {
                            chatbxWindow.classList.add('listingCarsOpen');
                            setTimeout(function() {
                                widgetChatbotHeight(shadowRoot);
                            }, 400);
                        }
                    }
                })
                .catch(error => console.error('Error:', error))
                .finally(() => {
                    loaderOverlay.style.display = "none";
                });
            };
            widgetChatbotHeight(shadowRoot);
        }

        function initializeCollapsibleElements() {
            const collapsibleElements = shadowRoot.querySelectorAll('[data-bs-toggle="collapse"]');
        
            collapsibleElements.forEach(element => {
                element.addEventListener('click', function(event) {
                    event.preventDefault(); // Prevent default link behavior
        
                    const targetId = element.getAttribute('href') || element.getAttribute('data-bs-target');
                    const collapseElement = shadowRoot.querySelector(targetId);
        
                    if (collapseElement) {
                        // Toggle the collapse state
                        if (collapseElement.classList.contains('show')) {
                            collapseElement.classList.remove('show');
                            element.classList.add('collapsed');
                        } else {
                            collapseElement.classList.add('show');
                            element.classList.remove('collapsed');
                        }
                    }
                });
            });
        }

        function chatbxFulldetails(shadowRoot) {
            const chatbxFulldetailInfo = shadowRoot.querySelector('.chatbx_fulldetail_info');
            const chatbxSubhead = shadowRoot.querySelector('.chatbx_fulldetail_info .chatbx_subhead');
            const chatbxDetailFull = shadowRoot.querySelector('.chatbx_detail_full');
        
            if (chatbxFulldetailInfo && chatbxSubhead && chatbxDetailFull) {
                const chatbxFulldetailsHeight = chatbxFulldetailInfo.clientHeight - chatbxSubhead.clientHeight;
                chatbxDetailFull.style.minHeight = `${chatbxFulldetailsHeight}px`;
                chatbxDetailFull.style.maxHeight = `${chatbxFulldetailsHeight}px`;
            }
        }

        function initializeDynamicComponents(shadowRoot) {
            // Attach functions to the shadowRoot
            shadowRoot.makemileagerange = function() {
                let minPrice = shadowRoot.querySelector('#minMileage').value.replace(/\$/g, '').replace(/,/g, '');
                let maxPrice = shadowRoot.querySelector('#maxMileage').value.replace(/\$/g, '').replace(/,/g, '');
                let priceRange = `${minPrice} - ${maxPrice}`;
        
                shadowRoot.querySelector('#miles_range').value = priceRange;
        
                shadowRoot.submitForm(); // Proceed to submit the form
            };
        
            shadowRoot.makeyearrange = function() {
                let minPrice = shadowRoot.querySelector('#minYear').value.replace(/\$/g, '').replace(/,/g, '');
                let maxPrice = shadowRoot.querySelector('#maxYear').value.replace(/\$/g, '').replace(/,/g, '');
                let priceRange = `${minPrice} - ${maxPrice}`;
        
                shadowRoot.querySelector('#year_range').value = priceRange;
        
                shadowRoot.submitForm(); // Proceed to submit the form
            };
        
            shadowRoot.makepricerange = function() {
                let minPrice = shadowRoot.querySelector('#minPrice').value.replace(/\$/g, '').replace(/,/g, '');
                let maxPrice = shadowRoot.querySelector('#maxPrice').value.replace(/\$/g, '').replace(/,/g, '');
                let priceRange = `${minPrice} - ${maxPrice}`;
        
                shadowRoot.querySelector('#price_range').value = priceRange;
        
                shadowRoot.submitForm(); // Proceed to submit the form
            };
        
            
        
            
        
            // Attach the form submit logic to shadowRoot as well
            shadowRoot.querySelectorAll('[data-action="makemileagerange"]').forEach(function(element) {
                element.addEventListener('click', function() {
                    shadowRoot.makemileagerange();
                });
            });
        
            shadowRoot.querySelectorAll('[data-action="makeyearrange"]').forEach(function(element) {
                element.addEventListener('click', function() {
                    shadowRoot.makeyearrange();
                });
            });
        
            shadowRoot.querySelectorAll('[data-action="makepricerange"]').forEach(function(element) {
                element.addEventListener('click', function() {
                    shadowRoot.makepricerange();
                });
            });
            
        
        } 
        shadowRoot.submitForm = function() {
            // Your form submission logic here
            var form = shadowRoot.getElementById("searchinput");

            if (form) {
                var formData = new FormData(form);
                var params = new URLSearchParams(formData).toString();
            
                var myurl =window.apiurl+'?' + params;
        
                // Make the API call
                shadowRoot.apiresult(myurl);
            } else {
                console.error('Form element with id "searchinput" not found.');
            }
        };
        function loadBootstrapJS(callback) {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js'; // Use the bundle that includes Popper.js
            script.onload = callback;
            shadowRoot.appendChild(script);
        }       

        // Load jQuery, Bootstrap, Owl Carousel, and initialize the chatbot
        loadScript('https://code.jquery.com/jquery-3.7.1.min.js', function() {
            loadScript('https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.6/dist/umd/popper.min.js', function() {
                loadScript('https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.min.js', function() {
                    
                    loadScript('https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/owl.carousel.min.js', function() {
                       
                            loadCSS('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css', initializeChatbot);
                       
                    });
                   
                    
                });
            });
        });
    });
})();
