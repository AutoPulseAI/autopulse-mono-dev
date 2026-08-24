(function() {
    document.addEventListener("DOMContentLoaded", function() {
        // Create a container for the chatbot widget
        const widgetContainer = document.createElement('div');
        widgetContainer.id = 'chatbot-widget';
       
        //  window.baseurl  = 'http://127.0.0.1:8000/';
        //  window.apiurl  = 'http://127.0.0.1:8000/api/vehicle';
       // https://chat.autopulse.ai/
         window.baseurl  = 'https://chat.autopulse.ai/';
       
        window.apiurl  = 'https://chat.autopulse.ai/api/vehicle';
        let userId = null;
        let context = ''; // Initially empty
        let conversation_id = ''; // Initially empty
        let conversationCount = 0; 
        let customerId = null;
        let booking=0;
        let booking_id= null;
        
        // Idle timer variables
        let idleTimer = null;
        let isFirstRequestMade = false;
        let lastActivityTime = Date.now();
        let idleTimeoutDuration = 60000; // 60 seconds in milliseconds (configurable)
        let idleMessageSent = false;
        let idleMessage = "Do you have any further query?"; // Configurable idle message
        
        // Chat persistence variables
        let chatStorageKey = null; // Will be set based on userId
        let chatStateLoaded = false;
        const shadowRoot = widgetContainer.attachShadow({ mode: 'open' });

        document.body.appendChild(widgetContainer);

        // Idle timer functions
        function getCurrentTime() {
            const now = new Date();
            return `${now.getHours()}:${(now.getMinutes() < 10 ? '0' : '') + now.getMinutes()}`;
        }

        function resetIdleTimer() {
            clearTimeout(idleTimer);
            lastActivityTime = Date.now();
            idleMessageSent = false;
            
            // Only start idle timer after first request is made
            if (isFirstRequestMade) {
                idleTimer = setTimeout(() => {
                    sendIdleMessage();
                }, idleTimeoutDuration);
            }
        }

        function sendIdleMessage() {
            // Only send if chat is open, conversation exists, and message hasn't been sent yet
            if (!idleMessageSent && conversation_id && shadowRoot.querySelector('.chatbx_main').style.display !== 'none') {
                idleMessageSent = true;
                
                // Add the idle message to chat
                const currentTime = getCurrentTime();
                const idleMessageHtml = `<div class="chatbx_msg_l idle-message"><small>${idleMessage}</small><span class="ch_time">${currentTime}</span></div>`;
                shadowRoot.querySelector('.chatbx_response').innerHTML += idleMessageHtml;
                
                // Scroll to bottom
                const chatResponse = shadowRoot.querySelector('.chatbx_response');
                if (chatResponse) {
                    chatResponse.scrollTop = chatResponse.scrollHeight;
                }
                
                // Log the idle message activity
                console.log('Idle message sent after user inactivity');
                
                // Optional: Track this as an automated message
                const idleData = {
                    conversion_id: conversation_id,
                    action: 'idle_message_sent',
                    source: userId,
                    current_url: window.location.href,
                    timestamp: new Date().toISOString()
                };
                
                // Send to analytics if needed
                if (typeof triggerClickButton === 'function') {
                    triggerClickButton(idleData);
                }
            }
        }

        function trackUserActivity() {
            if (isFirstRequestMade) {
                resetIdleTimer();
            }
        }

        // Chat persistence functions
        function initializeChatStorage(dealerId) {
            chatStorageKey = `chatbot_state_${dealerId}`;
        }

        function saveChatState() {
            if (!chatStorageKey) return;
            
            try {
                const chatState = {
                    // Chat data
                    conversation_id: conversation_id,
                    conversationCount: conversationCount,
                    context: context,
                    customerId: getCustomerIdFromStorage(),
                    booking_id: getBookingIdFromStorage(),
                    booking: booking,
                    
                    // Chat history (get from DOM)
                    chatHistory: getChatHistory(),
                    
                    // Idle timer state
                    isFirstRequestMade: isFirstRequestMade,
                    lastActivityTime: lastActivityTime,
                    idleMessageSent: idleMessageSent,
                    
                    // Timestamp
                    savedAt: Date.now(),
                    
                    // Page info
                    savedOnUrl: window.location.href,
                    savedOnTitle: document.title
                };
                
                localStorage.setItem(chatStorageKey, JSON.stringify(chatState));
                console.log('Chat state saved:', chatState);
            } catch (e) {
                console.error('Failed to save chat state:', e);
            }
        }

        function loadChatState() {
            if (!chatStorageKey || chatStateLoaded) return null;
            
            try {
                const savedState = localStorage.getItem(chatStorageKey);
                if (!savedState) return null;
                
                const chatState = JSON.parse(savedState);
                
                // Check if saved state is not too old (24 hours)
                const maxAge = 24 * 60 * 60 * 1000; // 24 hours
                if (Date.now() - chatState.savedAt > maxAge) {
                    localStorage.removeItem(chatStorageKey);
                    return null;
                }
                
                chatStateLoaded = true;
                console.log('Loading chat state:', chatState);
                return chatState;
            } catch (e) {
                console.error('Failed to load chat state:', e);
                return null;
            }
        }

        function restoreChatState(savedState) {
            if (!savedState) return;
            
            try {
                // Reset variables first
                resetChatVariables();
                
                // Only restore if we have valid conversation data
                if (savedState.conversation_id) {
                    conversation_id = savedState.conversation_id;
                    conversationCount = savedState.conversationCount || 0;
                    context = savedState.context || '';
                    customerId = savedState.customerId || null;
                    booking_id = savedState.booking_id || null;
                    booking = savedState.booking || 0;
                }
                
                // Restore idle timer state
                isFirstRequestMade = savedState.isFirstRequestMade || false;
                lastActivityTime = savedState.lastActivityTime || Date.now();
                idleMessageSent = savedState.idleMessageSent || false;
                
                // Restore chat history
                if (savedState.chatHistory && savedState.chatHistory.length > 0) {
                    restoreChatHistory(savedState.chatHistory);
                }
                
                // Restore UI state (after a small delay to ensure DOM is ready)
                setTimeout(() => {
                    if (savedState.isChatOpen) {
                        const chatMain = shadowRoot.querySelector('.chatbx_main');
                        if (chatMain) {
                            chatMain.style.display = 'block';
                        }
                    }
                    
                    if (savedState.isMinimized) {
                        const chatMain = shadowRoot.querySelector('.chatbx_main');
                        if (chatMain) {
                            chatMain.classList.add('collapsed');
                        }
                    }
                    
                    if (savedState.isFullScreen) {
                        const chatMain = shadowRoot.querySelector('.chatbx_main');
                        if (chatMain) {
                            chatMain.classList.add('chat_open');
                        }
                    }
                    
                    // Restart idle timer if needed
                    if (isFirstRequestMade) {
                        resetIdleTimer();
                    }
                }, 100);
                
                console.log('Chat state restored successfully');
            } catch (e) {
                console.error('Failed to restore chat state:', e);
            }
        }

        function getChatHistory() {
            const chatResponse = shadowRoot.querySelector('.chatbx_response');
            if (!chatResponse) return [];
            
            const messages = [];
            const messageElements = chatResponse.querySelectorAll('.chatbx_msg_l, .chatbx_msg_r');
            
            messageElements.forEach(element => {
                const small = element.querySelector('small');
                const timeSpan = element.querySelector('.ch_time');
                
                // Skip welcome messages to prevent duplication
                if (small && !small.classList.contains('welcome_message')) {
                    messages.push({
                        content: small.innerHTML,
                        type: element.classList.contains('chatbx_msg_r') ? 'user' : 'bot',
                        time: timeSpan ? timeSpan.textContent : '',
                        classes: Array.from(element.classList),
                        fullHtml: element.outerHTML
                    });
                }
            });
            
            return messages;
        }

        function restoreChatHistory(messages) {
            const chatResponse = shadowRoot.querySelector('.chatbx_response');
            if (!chatResponse || !messages.length) return;
            
            // Clear current history except welcome message
            const welcomeMessage = chatResponse.querySelector('.welcome_message');
            if (welcomeMessage) {
                const welcomeHtml = welcomeMessage.closest('.chatbx_msg_l').outerHTML;
                chatResponse.innerHTML = welcomeHtml;
            } else {
                chatResponse.innerHTML = '';
            }
            
            // Restore messages, filtering out any welcome messages that might have been saved
            messages.forEach(message => {
                if (message.fullHtml && !message.content.includes('welcome_message')) {
                    chatResponse.innerHTML += message.fullHtml;
                }
            });
            
            // Scroll to bottom
            chatResponse.scrollTop = chatResponse.scrollHeight;
        }

        function clearChatState() {
            if (chatStorageKey) {
                localStorage.removeItem(chatStorageKey);
            }
            
            // Also clear customer registration data
            localStorage.removeItem('chatbotRegisteredCustomer');
            
            // Reset all chat variables to initial state
            resetChatVariables();
            
            console.log('Chat state and customer data cleared');
        }

        function resetChatVariables() {
            conversation_id = '';
            conversationCount = 0;
            context = '';
            customerId = null;
            booking_id = null;
            booking = 0;
            isFirstRequestMade = false;
            lastActivityTime = Date.now();
            idleMessageSent = false;
        }

        function cleanupDuplicateWelcomeMessages() {
            const chatResponse = shadowRoot.querySelector('.chatbx_response');
            if (!chatResponse) return;
            
            const welcomeMessages = chatResponse.querySelectorAll('.welcome_message');
            if (welcomeMessages.length > 1) {
                // Keep only the first welcome message, remove duplicates
                for (let i = 1; i < welcomeMessages.length; i++) {
                    const welcomeElement = welcomeMessages[i];
                    const messageContainer = welcomeElement.closest('.chatbx_msg_l');
                    if (messageContainer) {
                        messageContainer.remove();
                    }
                }
                console.log('Cleaned up duplicate welcome messages');
            }
        }

        // The base styles and HTML will be injected into the shadow DOM
        const widgetStyles = `
            /* Add your widget-specific styles here */
            @import url('https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css');
            @import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap');
            @import url('https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap');
            @import url('${window.baseurl}assets/css/auto.min.css');
            @import url('https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.5.0/nouislider.min.css');
            @import url('https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/assets/owl.carousel.min.css');
          
            /* Additional styles for shadow DOM isolation */
            .chatboxAi {
                position: fixed;
                bottom: 0;
                right: 0;
                width: 350px;
                z-index: 99999;
                font-family: "Montserrat", sans-serif;
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
            .idle-message small{
                font-style: italic;
            }
            .idle-message small {

            }
            .chatboxAi .chatbx_head{
                height: 50px;
                padding: 6px 12px;
            }
            /* Additional widget styles go here */
        `;

        const widgetHtml = `
            <div class="position-relative chatboxAi">
                <div class="chatboxO chatbox_ri">
                    <div class="banner_chatbox_o">
                        <a class="chatboxO_a_main">
                            <span class="banner_chatbox_text" id="chatbot-name">Ask a question with </span>
                            <span class="banner_chatbox_icon">
                                <img src="https://example.com/assets/images/chatbxSearch.png" id="chatbot-logo" alt="chat" class="img-fluid">
                            </span>
                        </a>
                    </div>
                </div>

                <div class="chatbx_main chatbox_ri">
                    <div class="chatbx_secondary chatbx_car_details">            
                        <div class="chatbx_fulldetail_info chatbxdetails_show" id="chatbx_car_details"></div>
                    </div>

                    <div class="chatbx_primary">
                        <div class="chatbx_head">
                            <img src="${window.baseurl}assets/images/auto/auto_ai.png" alt="img" id="chatbot-auto-logo">
                            <a class="full_screen ms-auto head_icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#051622" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-maximize"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#051622" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-minimize"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>
                                </a>
                            <a class="mini_a ms-1 head_icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#051622" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-minus"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </a>
                            <a class="chatboxO_a ms-1 head_icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#051622" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </a>
                        </div>                  
                        
                        <div class="chatbx_body" id="chatbx_body"></div>
                        
                    </div>
                    <div id="widget_loader-overlay" class="widget_loader_overlay" style="display: none;">
                        <div class="widget_loader"></div>
                    </div>
                </div>
            </div>
            <audio id="chatOpenSound" preload="auto">
                <source src="${window.baseurl}assets/mp3/bell.ogg" type="audio/ogg">
            </audio>
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

        function showChatWindow() {
            const isRegistered = checkCustomerRegistration();
            console.log(isRegistered);
            if(!isRegistered) {
                booking=0;
                booking_id=null;
                context='';
                conversation_id='';
                conversationCount=0;
                customerId=null;
                isFirstRequestMade=false;
                lastActivityTime=Date.now();
                idleMessageSent=false;
                idleMessage='Do you have any further query?';
                idleTimeoutDuration=60000;
                idleTimer=null;
                chatStateLoaded=false;
                chatStorageKey=null;
            }
            const showchatwindow = shadowRoot.getElementById('chatbx_body');
            showchatwindow.innerHTML = `
                <div class="explore_main" id="explore_main"></div>

                <div class="chatbx_window">
                    <div class="chatbx_response">
                        <div class="chatbx_msg_l">
                            <small class="welcome_message">Hello, my name is <b></b>, your AI auto concierge. How can I help you?</small>
                        </div>
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
                        <a id="sendBtn" class="head_icon send_btn">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-send"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                        </a>
                    </div>
                    <small id="charCount" class="text-muted">0/2000</small>
                </div>
            `;
        }

        function showRegWindow() {
            const showregwindow = shadowRoot.getElementById('chatbx_body');
            showregwindow.innerHTML = `
                <div class="reg_form">
                    <div class="reg_top">
                        <div class="reg_bot">
                            <img src="${window.baseurl}assets/images/bot.webp" alt="bot" class="img-fluid">
                        </div>
                        <h5>Welcome!</h5>
                        <p><small>Register now to join the chat.</small></p>
                    </div>
                    <form id="customerRegistrationForm">
                        <div class="row g-2">
                            <div class="col col-6">
                                <input type="text" id="regFirstName" class="form-control" placeholder="First Name" required>
                                <div id="firstNameError" class="error-message"></div>
                            </div>
                            <div class="col col-6">
                                <input type="text" id="regLastName" class="form-control" placeholder="Last Name" required>
                                <div id="lastNameError" class="error-message"></div>
                            </div>
                            <div class="col col-12">
                                <input type="email" id="regEmail" class="form-control" placeholder="Email">
                                <div id="emailError" class="error-message text-danger text_xs"></div>
                            </div>
                            <div class="col col-12">
                                <input type="tel" id="regPhone" class="form-control" placeholder="Phone Number">
                                <div id="phoneError" class="error-message text-danger text_xs"></div>
                            </div>
                            <div class="col col-12">
                                <small class="text_xs" id="validation_msg">Please provide either an email address or phone number.</small>
                                <button type="submit" class="btn_chatbx_fill w-100 mt-2 btn-submit">Submit</button>
                                <button type="button" class="btn_chatbx_outline btn_chatbx_fill w-100 mt-1 btn-submit skip-btn">Skip</button>
                            </div>
                        </div>
                    </form>
                </div>
            `;

            // Add styles for error messages and form layout
            const style = document.createElement('style');
            style.textContent = `
                .chatbxbody_reg {
                    min-height: 500px;
                }
            `;
            shadowRoot.appendChild(style);
            
            // Handle form submission
            const registrationForm = shadowRoot.getElementById('customerRegistrationForm');
            registrationForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                // Reset previous errors
                clearErrorMessages();
                
                // Get form values
                const firstName = shadowRoot.getElementById('regFirstName').value.trim();
                const lastName = shadowRoot.getElementById('regLastName').value.trim();
                const email = shadowRoot.getElementById('regEmail').value.trim();
                const phone = shadowRoot.getElementById('regPhone').value.trim();
                
                let isValid = true;
                
                // Validate first name
                if (!firstName) {
                    showError('firstNameError', 'First name is required');
                    isValid = false;
                }
                
                // Validate last name
                if (!lastName) {
                    showError('lastNameError', 'Last name is required');
                    isValid = false;
                }
                
                // Validate email and phone - require at least one
                if (!email && !phone) {
                    showError('emailError', '');
                    showError('phoneError', '');
                    const validationMsg = shadowRoot.getElementById('validation_msg');
                    validationMsg.classList.add('error');
                    isValid = false;
                } else {
                    // If email is provided, validate it
                    if (email && !validateEmail(email)) {
                        showError('emailError', 'Please enter a valid email address');
                        isValid = false;
                    }
                    // If phone is provided, validate it (must be exactly 10 digits)
                    if (phone && !validatePhone(phone)) {
                        showError('phoneError', 'Please enter a valid 10-digit phone number');
                        isValid = false;
                    }
                }
                
                if (!isValid) return;
                
                // Show loading state
                const submitBtn = registrationForm.querySelector('.btn-submit');
                submitBtn.disabled = true;
                submitBtn.textContent = 'Submitting...';
                
                try {
                    // Prepare form data for API
                    const formData = new FormData();
                    formData.append('first_name', firstName);
                    formData.append('last_name', lastName);
                    formData.append('email', email);
                    formData.append('phone_number', phone);
                    formData.append('dealerId', userId);
                    // Page information
                    formData.append('current_url', window.location.href);
                    formData.append('page_title', document.title);
                    formData.append('referrer', document.referrer || '');
                    
                    // Send registration data to API
                    const response = await fetch(window.baseurl + 'api/vehicel/adfMail', {
                        method: 'POST',
                        body: formData
                    });
                    
                    const data = await response.json();
                    
                    if (data.success && data.data) {
                        // Registration successful
                        customerId = data.data.id;
                        
                        // Save customer data
                        const customerData = {
                            customerId,
                            firstName,
                            lastName,
                            email,
                            phone,
                            registrationDate: new Date().toISOString(),
                            vehicleInfo: {
                                vin: data.data.vin,
                                make: data.data.make,
                                model: data.data.model,
                                year: data.data.year
                            }
                        };
                        
                        localStorage.setItem('chatbotRegisteredCustomer', JSON.stringify(customerData));
                        isCustomerRegistered = true;
                        
                        shadowRoot.querySelector('.chatbx_body').classList.remove('chatbxbody_reg');
                        shadowRoot.querySelector('.chatbx_body').classList.add('chatbxbody_chat');
                        showChatWindow();                        
                        // enableChatInput();
                        initializeChatbot();
                        // startInactivityTimer();
                        
                    } else {
                        throw new Error(data.message || 'Registration failed');
                    }
                } catch (error) {
                    showError('emailError', 'Registration failed. Please try again.');
                    console.error('Registration error:', error);
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Start Chatting';
                }
            });

            shadowRoot.querySelector('.skip-btn').addEventListener('click', function() {
                // Create a minimal customer record with just a timestamp
                const customerData = {
                    customerId: 'guest_' + Date.now(),
                    registrationDate: new Date().toISOString(),
                    isGuest: true
                };
                
                isCustomerRegistered = true;
                
                shadowRoot.querySelector('.chatbx_body').classList.remove('chatbxbody_reg');
                shadowRoot.querySelector('.chatbx_body').classList.add('chatbxbody_chat');
                showChatWindow();
                initializeChatbot();
            });

            // Add real-time validation
            const emailField = shadowRoot.getElementById('regEmail');
            const phoneField = shadowRoot.getElementById('regPhone');
            
            function checkContactFields() {
                const email = emailField.value.trim();
                const phone = phoneField.value.trim();
                
                // Clear contact-related errors if either field has value
                if (email || phone) {
                    clearError('emailError');
                    clearError('phoneError');
                }
            }
            
            emailField.addEventListener('input', checkContactFields);
            phoneField.addEventListener('input', checkContactFields);

            // Helper functions for error handling
            function showError(elementId, message) {
                const element = shadowRoot.getElementById(elementId);
                if (element) {
                    element.textContent = message;
                    element.classList.add('show');
                    const inputField = element.previousElementSibling;
                    if (inputField) inputField.classList.add('error');
                }
            }
            
            function clearError(elementId) {
                const element = shadowRoot.getElementById(elementId);
                if (element) {
                    element.textContent = '';
                    element.classList.remove('show');
                    const inputField = element.previousElementSibling;
                    if (inputField) inputField.classList.remove('error');
                    const validationMsg = shadowRoot.getElementById('validation_msg');
                    validationMsg.classList.remove('error');
                }
            }
            
            function clearErrorMessages() {
                const errorMessages = shadowRoot.querySelectorAll('.error-message');
                errorMessages.forEach(msg => {
                    msg.textContent = '';
                    msg.classList.remove('show');
                    const inputField = msg.previousElementSibling;
                    if (inputField) inputField.classList.remove('error');
                });
            }
        }

        // Email validation helper
        function validateEmail(email) {
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return re.test(email);
        }

        function validatePhone(phone) {
            // Remove all non-digit characters
            const phoneDigits = phone.replace(/\D/g, '');
            // Check if it's exactly 10 digits
            return phoneDigits.length === 10;
        }

        // Get customer ID from localStorage (not from variables)
        function getCustomerIdFromStorage() {
            const registeredCustomer = localStorage.getItem('chatbotRegisteredCustomer');
            if (registeredCustomer) {
                const customerData = JSON.parse(registeredCustomer);
                return customerData.customerId || null;
            }
            return null;
        }

        // Get booking ID from localStorage (not from variables)
        function getBookingIdFromStorage() {
            if (!chatStorageKey) return null;
            try {
                const savedState = localStorage.getItem(chatStorageKey);
                if (savedState) {
                    const chatState = JSON.parse(savedState);
                    return chatState.booking_id || null;
                }
            } catch (e) {
                console.error('Failed to get booking_id from storage:', e);
            }
            return null;
        }

        // Get conversation ID from localStorage (not from variables)
        function getConversationIdFromStorage() {
            if (!chatStorageKey) return null;
            try {
                const savedState = localStorage.getItem(chatStorageKey);
                if (savedState) {
                    const chatState = JSON.parse(savedState);
                    return chatState.conversation_id || null;
                }
            } catch (e) {
                console.error('Failed to get conversation_id from storage:', e);
            }
            return null;
        }

        // Check if customer is already registered in localStorage
        function checkCustomerRegistration() {
            const registeredCustomer = localStorage.getItem('chatbotRegisteredCustomer');
            if (registeredCustomer) {
                const customerData = JSON.parse(registeredCustomer);
                customerId = customerData.customerId;
                isCustomerRegistered = true;
                return true;
            }
            return false;
        }

        const isRegistered = checkCustomerRegistration();

        if(!isRegistered) {
            const chatbxBody = shadowRoot.querySelector('.chatbx_body');
            chatbxBody.classList.add('chatbxbody_reg');
            showRegWindow();
        } else {
            const chatbxBody = shadowRoot.querySelector('.chatbx_body');
            chatbxBody.classList.add('chatbxbody_chat');
            showChatWindow();
        }
        console.log(isRegistered);

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
                    let headHeight = chatbxHead.clientHeight === 0 ? 49 : chatbxHead.clientHeight;
                    let chatbxWindowHeight = chatbxPrimary.clientHeight - (headHeight + chatbxInput.clientHeight);

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
                    let headHeight = chatbxHead.clientHeight === 0 ? 49 : chatbxHead.clientHeight;
                    let chatbxWindowHeight = window.innerHeight - (headHeight + chatbxInput.clientHeight);

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
            const scripts = document.querySelectorAll('script[src*="shaddow.js"]');
            
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
            
            // Initialize chat storage
            initializeChatStorage(userId);
            
            // Try to load existing chat state
            const savedChatState = loadChatState();
            
            // Log page information when chat is initialized
            const pageInfo = {
                current_url: window.location.href,
                page_title: document.title,
                referrer: document.referrer || '',
                user_agent: navigator.userAgent,
                timestamp: new Date().toISOString(),
                dealerId: userId,
                hasStoredState: !!savedChatState
            };
            console.log('Chat widget initialized on page:', pageInfo);
            
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
                            // Watch for new messages and add chatbot name automatically
                            const chatbotName = data.data.dealership_name || 'AI';
                            const chatContainer = shadowRoot.querySelector('.chatboxAi .chatbx_response');

                            if (chatContainer) {
                            // ✅ 1. Update existing messages immediately
                            chatContainer.querySelectorAll('.chatbx_msg_l').forEach(el => {
                                el.setAttribute('data-chatbot-name', chatbotName);
                            });

                            // ✅ 2. Watch for new messages and add chatbot name automatically
                            const observer = new MutationObserver(mutations => {
                                mutations.forEach(mutation => {
                                    mutation.addedNodes.forEach(node => {
                                        if (node.nodeType === 1 && node.classList.contains('chatbx_msg_l')) {
                                            node.setAttribute('data-chatbot-name', chatbotName);
                                        }
                                    });
                                });
                            });

                            observer.observe(chatContainer, { childList: true, subtree: true });
}

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
                                    border-radius: 4px 0 4px 4px;
                                }
                                .chatboxAi .chatbx_response .chatbx_msg_l::after {
                                    content: attr(data-chatbot-name);
                                    position: absolute;
                                    left: 0;
                                    top: -3px;
                                    font-size: 11px;
                                    color: var(--secondary);
                                    display: block;
                                }
                                /* 👇 Show gray box until chatbot name is loaded */
                                .chatboxAi .chatbx_response .chatbx_msg_l:not([data-chatbot-name])::after,
                                .chatboxAi .chatbx_response .chatbx_msg_l[data-chatbot-name=""]::after {
                                    content: '';
                                    position: absolute;
                                    left: 0;
                                    top: 1px;
                                    display: inline-block;
                                    width: 50px;
                                    height: 11px;
                                    background-color: var(--gray);
                                    border-radius: 3px;
                                }
                            `;
                            shadowRoot.appendChild(dynamicStyle);

                            // Set custom properties for colors
                            shadowRoot.host.style.setProperty('--chbxprimary', primarycolor);
                            let hexColor = primarycolor;
                            let rgbColor = hexToRgb(hexColor);
                            let alpha = 0.09;
                            let rgbaColor = `rgba(${rgbColor}, ${alpha})`;
                            shadowRoot.host.style.setProperty('--chbxprimary-light', rgbaColor); 
                            shadowRoot.host.style.setProperty('--dark', '#222732');
                            shadowRoot.host.style.setProperty('--dark-light', '#2F3B48');
                            shadowRoot.host.style.setProperty('--gray', '#EFF3FA');
                            shadowRoot.host.style.setProperty('--white', '#ffffff');
                            shadowRoot.host.style.setProperty('--secondary', '#99A1B2');
                            
                            // Restore chat state after settings are loaded and DOM is ready
                            setTimeout(() => {
                                if (savedChatState) {
                                    restoreChatState(savedChatState);
                                }
                                // Clean up any duplicate welcome messages
                                cleanupDuplicateWelcomeMessages();
                            }, 500); // Wait for DOM to be fully ready
                        } else {
                            console.error('Failed to load chatbot settings:', data.message);
                            // Clean up any duplicate welcome messages even if settings failed
                            setTimeout(() => {
                                cleanupDuplicateWelcomeMessages();
                            }, 500);
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching chatbot settings:', error);
                    });
            } else {
                console.error('User ID not found.');
            }
            createLightboxContainer();

            let chatOpenedByUser = false;
            shadowRoot.addEventListener('click', function(event) {
                if (event.target.closest('.chatboxO_a')) {
                    chatOpenedByUser = true; // User interacted
                    const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                    const chatbxBody = shadowRoot.querySelector('.chatbx_body');
                    const chatbxWindow = shadowRoot.querySelector('.chatbx_window');
                    const chatbxCloseConf = shadowRoot.querySelector('.chatbx_close_conf');
                    const chatbxFullDetail = shadowRoot.querySelector('.chatbx_fulldetail_info');
                
                    if (chatbxMain.classList.contains('chat_open') && chatbxBody.classList.contains('chatbxbody_reg')){
                        chatbxMain.classList.remove('chat_open');
                    } else if (chatbxMain.classList.contains('chat_open') ) {
                        if(chatbxWindow){chatbxWindow.style.overflowY = 'hidden';}
                        if(chatbxFullDetail){chatbxFullDetail.classList.remove('chatbxdetails_show')};
                        if(chatbxMain){chatbxMain.classList.remove('collapsed');}
                        if(chatbxCloseConf){chatbxCloseConf.style.display = 'block';}
                    } else {
                        chatbxMain.classList.add('chat_open');
                    }
                } else if (event.target.closest('.chatboxO_a_main')) {
                    chatOpenedByUser = true; // User interacted
                    const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                    chatbxMain.classList.add('chat_open');
                }
            });

            // Auto-open after 15 seconds if not opened manually
            setTimeout(() => {
                const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                const audio = shadowRoot.querySelector('#chatOpenSound');
                
                if (!chatOpenedByUser && chatbxMain && !chatbxMain.classList.contains('chat_open')) {
                    chatbxMain.classList.add('chat_open');

                    // Play sound safely
                    if (audio) {
                        try {
                            audio.currentTime = 0;
                            audio.play().catch((err) => {
                                console.warn('Autoplay blocked:', err);
                            });
                        } catch (e) {
                            console.warn('Audio play error:', e);
                        }
                    }
                }
            }, 15000);

            let audioAllowed = false;
            function unlockAudio() {
                const audio = shadowRoot.querySelector('#chatOpenSound');
                if (audio) {
                    audio.play().then(() => {
                        audio.pause(); // Immediately pause, just to unlock it
                        audio.currentTime = 0;
                        audioAllowed = true;
                    }).catch(() => {
                        // Ignored — some browsers still require actual user gesture
                    });
                }

                // Remove this event listener after first interaction
                document.removeEventListener('pointerdown', unlockAudio);
                document.removeEventListener('click', unlockAudio);
                document.removeEventListener('touchstart', unlockAudio);
                document.removeEventListener('keydown', unlockAudio);
            }

            // Listen for any interaction
            document.addEventListener('pointerdown', unlockAudio);
            document.addEventListener('click', unlockAudio);
            document.addEventListener('touchstart', unlockAudio);
            document.addEventListener('keydown', unlockAudio);

            shadowRoot.addEventListener('click', function (e) {
                const closeYesBtn = e.target.closest('.chatbx_close_yes');

                if (closeYesBtn) {
                    const chatbxWindow = shadowRoot.querySelector('.chatbx_window');
                    const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                    const chatbxResponse = shadowRoot.querySelector('.chatbx_response');
                    const chatbxCloseConf = shadowRoot.querySelector('.chatbx_close_conf');
                
                    chatbxCloseConf.style.display = 'none';
                    chatbxWindow.style.overflowY = 'auto';
                    chatbxMain.classList.remove('chat_open');
                    chatbxResponse.innerHTML = `<div class="chatbx_msg_l"><small class="welcome_message">Hello, my name is Autopulse, your AI automotive concierge.</small></div>`;
                    
                    // Reset conversation variables
                    context = '';
                    lastUserInput = '';
                    lastFormData = {};
                    if(conversation_id){
                        const data = {
                            'userId': userId, // Assuming userId is defined in your script
                            'conversion_id': conversation_id,
                            'customerId': getCustomerIdFromStorage(),
                        
                        };
                        closechaturl(data);
                    }
                    conversation_id = '';
                    
                    // Reset idle timer when chat is closed
                    clearTimeout(idleTimer);
                    isFirstRequestMade = false;
                    idleMessageSent = false;
                    
                    // Clear saved chat state when conversation ends
                    clearChatState();
                    
                    resetchatbx(shadowRoot);
                    widgetChatbotHeight(shadowRoot);
                }
            });
            
            // shadowRoot.querySelector('.chatbx_close_no').addEventListener('click', function(e) {
            shadowRoot.addEventListener('click', function (e) {
                const closeNoBtn = e.target.closest('.chatbx_close_no');

                if(closeNoBtn){
                    const chatbxWindow = shadowRoot.querySelector('.chatbx_window');
                    const chatbxCloseConf = shadowRoot.querySelector('.chatbx_close_conf');
                
                    chatbxCloseConf.style.display = 'none';
                    chatbxWindow.style.overflowY = 'auto';
                }
            });
            
            // full_screen and mini_a
            const fullScreenBtn = shadowRoot.querySelector('.full_screen');
            const miniBtn = shadowRoot.querySelector('.mini_a');

            // ✅ Remove previous listeners safely before re-binding
            const newFullScreenBtn = fullScreenBtn.cloneNode(true);
            fullScreenBtn.parentNode.replaceChild(newFullScreenBtn, fullScreenBtn);

            const newMiniBtn = miniBtn.cloneNode(true);
            miniBtn.parentNode.replaceChild(newMiniBtn, miniBtn);

            // Re-select new elements
            const freshFullScreenBtn = shadowRoot.querySelector('.full_screen');
            const freshMiniBtn = shadowRoot.querySelector('.mini_a');

            // ✅ Bind once
            freshFullScreenBtn.addEventListener('click', function (e) {
                e.preventDefault();
                const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                chatbxMain.classList.toggle('fullScreen');
                chatbxListingCars();
                chatbxListingFilter();
                widgetChatbotHeight(shadowRoot);
                initializeCarousel();
            });

            freshMiniBtn.addEventListener('click', function (e) {
                e.preventDefault();
                const chatbxMain = shadowRoot.querySelector('.chatbx_main');
                chatbxMain.classList.toggle('chat_open');
            });
            
            const sendBtn = shadowRoot.querySelector('#sendBtn');
            if (sendBtn) {
                sendBtn.addEventListener('click', function () {
                    sendUserMessage();
                });
            }

            // Add activity tracking event listeners
            const userInput = shadowRoot.querySelector('#userInput');
            if (userInput) {
                // Track typing activity
                userInput.addEventListener('input', trackUserActivity);
                userInput.addEventListener('focus', trackUserActivity);
                userInput.addEventListener('click', trackUserActivity);
            }

            // Track clicks anywhere in the chat widget
            shadowRoot.addEventListener('click', function(e) {
                // Only track activity for interactive elements
                if (e.target.closest('button') || 
                    e.target.closest('input') || 
                    e.target.closest('a') || 
                    e.target.closest('.btn_expand') ||
                    e.target.closest('.btn_exploere_more')) {
                    trackUserActivity();
                }
                
                // Save state on UI interactions that change chat state
                if (e.target.closest('.chatboxO_a') || 
                    e.target.closest('.mini_a') || 
                    e.target.closest('.full_screen') ||
                    e.target.closest('.chatbx_close_yes') ||
                    e.target.closest('.chatbx_close_no')) {
                    setTimeout(() => {
                        saveChatState();
                    }, 100); // Small delay to ensure DOM changes are applied
                }
            });

            // Auto-save on page unload/reload
            window.addEventListener('beforeunload', function() {
                saveChatState();
            });

            // Auto-save on visibility change (tab switch)
            document.addEventListener('visibilitychange', function() {
                if (document.hidden) {
                    saveChatState();
                }
            });

            // Auto-save periodically for long conversations
            setInterval(() => {
                if (conversation_id && isFirstRequestMade) {
                    saveChatState();
                }
            }, 30000); // Save every 30 seconds during active conversations


            // Send message on Enter key (userInput already declared above)
            if (userInput) {
                userInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        sendUserMessage();
                    }
                });
            }

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
                
                // Mark that first request has been made and start idle timer
                if (!isFirstRequestMade) {
                    isFirstRequestMade = true;
                    console.log('First user request made, starting idle timer');
                }
                
                // Track user activity and reset idle timer
                trackUserActivity();
                
                conversationCount++;
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
            
                // Get customer data from localStorage if available
                let customerInfo = {};
                const storedCustomer = localStorage.getItem('chatbotRegisteredCustomer');
                if (storedCustomer) {
                    try {
                        customerInfo = JSON.parse(storedCustomer);
                    } catch (e) {
                        console.warn('Error parsing stored customer data:', e);
                    }
                }

                // Prepare the data to be sent
                const formData = {
                    request: userInput,
                    context: context || '',
                    conversation_id: getConversationIdFromStorage() || conversation_id || '',
                    dealerId: userId,
                    customerId: getCustomerIdFromStorage(),
                    booking_id: getBookingIdFromStorage(),
                    // Customer information from forms
                    customer_name: customerInfo.firstName && customerInfo.lastName ? 
                        `${customerInfo.firstName} ${customerInfo.lastName}` : 
                        (customerInfo.name || ''),
                    customer_email: customerInfo.email || '',
                    customer_phone: customerInfo.phone || customerInfo.phone_number || '',
                    booking_date: customerInfo.booking_date || '',
                    booking_time: customerInfo.booking_time || '',
                    // Page information
                    current_url: window.location.href,
                    page_title: document.title,
                    referrer: document.referrer || '',
                    user_agent: navigator.userAgent,
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

                        let message='';
                        if(data.Message){
                            message= data.Message;
                        }
                       
                        if (html) {
                            console.log('inside html');
                            let carhtml = `
                                <div class="chatbx_car_card_main">
                                    <div class="owl-carousel owl-theme chatbx_cars_slides circular_nav">${html}</div><div>${message}</div>
                                    <span class="ch_time">${getCurrentTime()}</span>
                                </div>`;
                            shadowRoot.querySelector('.chatbx_response').innerHTML += carhtml;
                        }
                      
                        if (conversationCount == 5) {
                            appendBookingPrompt(false);
                        }
                        if(data.booking_enable){
                            appendBookingPrompt(true); 
                        }
                        if(data.updated_customer_id){
                            customerId = data.updated_customer_id;
                        }
                        initializeCarousel();
                        bindButtonListeners();
                       
            
                        // Scroll to the bottom
                        shadowRoot.querySelector('.chatbx_window').scrollTop = shadowRoot.querySelector('.chatbx_window').scrollHeight;
                        
                        // Save chat state after receiving response
                        saveChatState();
                    } else {
                        displayErrorMessage('Failed to fetch data from the API');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                    displayErrorMessage('Error fetching chatbot response');
                    // Save state even on error
                    saveChatState();
                });
            }

            function bindButtonListeners() {
                shadowRoot.querySelectorAll('.btn_expand').forEach(button => {
                    button.removeEventListener('click', handleExpandButtonClick); // Remove previous listeners
                    button.addEventListener('click', function() {
                        handleExpandButtonClick(button);
                    });
                });
            
                shadowRoot.querySelectorAll('.btn_exploere_more').forEach(button => {
                    button.removeEventListener('click', handleapicall); // Remove previous listeners
                    button.addEventListener('click', function() {
                        handleapicall(button);
                    });
                });
            }

            function appendBookingPrompt(booking_enable=false) {
                console.log('appendBookingPrompt called with booking_enable:', booking_enable);
                console.log('shadowRoot available:', !!shadowRoot);
                console.log('chatbx_response element:', !!shadowRoot.querySelector('.chatbx_response'));
                
                const uniquePromptId = `prompt_${Date.now()}`;
                const bookingPrompt = `
                    <div class="chatbx_msg_l" id="${uniquePromptId}">
                        <small>Would you like me to help schedule an appointment to view our inventory in person?</small>
                        <div class="calendr">
                            <button class="calendr_yes_btn" data-prompt-id="${uniquePromptId}">
                                <img src="${window.baseurl}assets/images/booking/schedule.png" alt="schedule" class="calendr_icon">
                                <small class="calendr_yes">Yes</small>
                            </button>
                            <button class="calendr_no_btn" data-prompt-id="${uniquePromptId}">
                                <small class="calendr_no">No</small>
                            </button>
                        </div>
                    </div>`;
                    shadowRoot.querySelector('.chatbx_response').innerHTML += bookingPrompt;
                    const yesButton = shadowRoot.querySelector(`#${uniquePromptId} .calendr_yes_btn`);
                    const noButton = shadowRoot.querySelector(`#${uniquePromptId} .calendr_no_btn`);

                // Handle "Yes" button click
                if (yesButton) {

                    yesButton.addEventListener('click', () => {
                        console.log('Yes button clicked');
                        shadowRoot.querySelector('.chatbx_response').innerHTML += `<div class="chatbx_msg_r"><small>Yes</small><span class="ch_time">${getCurrentTime()}</span></div>`;
                        displayBookingForm(uniquePromptId);

                        // Disable buttons after click
                        yesButton.disabled = true;
                        noButton.disabled = true;
                        initializeCarousel();
                        bindButtonListeners();
                    });
                }

                // Handle "No" button click
                if (noButton) {
                    noButton.addEventListener('click', () => {
                        console.log('No button clicked');
                        shadowRoot.querySelector('.chatbx_response').innerHTML += `<div class="chatbx_msg_r"><small>No</small><span class="ch_time">${getCurrentTime()}</span></div>`;

                        // Disable buttons after click
                        yesButton.disabled = true;
                        noButton.disabled = true;
                        initializeCarousel();
                        bindButtonListeners();
                    });
                }

                // Auto-trigger "Yes" button if booking_enable is true
                if (booking_enable === true) {
                    console.log('Auto-triggering Yes button for booking');
                    
                    // Add visual feedback that auto-booking is happening
                    const autoBookingMessage = `<div class="chatbx_msg_r"><small>Auto-scheduling appointment...</small><span class="ch_time">${getCurrentTime()}</span></div>`;
                    shadowRoot.querySelector('.chatbx_response').innerHTML += autoBookingMessage;
                    
                    // Small delay to ensure DOM is ready and user sees the message
                    setTimeout(() => {
                        if (yesButton) {
                            // Add loading state to button
                            yesButton.innerHTML = '<small class="calendr_yes">Scheduling...</small>';
                            yesButton.disabled = true;
                            noButton.disabled = true;
                        }
                        
                        // Directly call displayBookingForm instead of simulating button click
                        setTimeout(() => {
                            console.log('Auto-triggering displayBookingForm');
                            try {
                                displayBookingForm(uniquePromptId);
                            } catch (error) {
                                console.error('Error in auto-trigger displayBookingForm:', error);
                                // Fallback: try to trigger the button click
                                if (yesButton) {
                                    yesButton.click();
                                }
                            }
                        }, 300);
                    }, 300);
                }
            }
            
            // Function to check if booking should be auto-enabled
            function shouldAutoEnableBooking() {
                // Check if user has shown interest in vehicles
                const hasVehicleInterest = window.chatbotData && window.chatbotData.vehicle_interest;
                
                // Check if user has been active for a while
                const hasBeenActive = window.chatbotData && window.chatbotData.conversation_length > 5;
                
                // Check if user has asked about inventory or viewing
                const hasInventoryInterest = window.chatbotData && window.chatbotData.inventory_questions;
                
                // Auto-enable if multiple conditions are met
                return (hasVehicleInterest && hasBeenActive) || hasInventoryInterest;
            }

            // Function to trigger booking prompt with auto-enable
            function triggerBookingPrompt(autoEnable = false) {
                if (autoEnable || shouldAutoEnableBooking()) {
                    appendBookingPrompt(true);
                } else {
                    appendBookingPrompt(false);
                }
            }

            // Make functions accessible globally
            window.triggerBookingPrompt = triggerBookingPrompt;
            window.appendBookingPrompt = appendBookingPrompt;
            window.shouldAutoEnableBooking = shouldAutoEnableBooking;

            // Test function for auto-booking
            window.testAutoBooking = function() {
                console.log('Testing auto-booking functionality...');
                appendBookingPrompt(true);
            };

            // Function to display the booking form
            function displayBookingForm(promptId) {
                console.log('displayBookingForm called with promptId:', promptId);
                const todayDate = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
                const uniqueFormId = `bookingForm_${promptId}`; // Unique form ID based on prompt ID
                const { customerId = '', email = '', phone = '', firstName = '', lastName = '' } = JSON.parse(localStorage.getItem('chatbotRegisteredCustomer') || '{}');
                const bookingFormHtml = `
                    <div class="chatbx_msg_l" id="${uniqueFormId}" style="display:block;">
                        <div class="time_slot_bx">
                            <form id="form_${promptId}" class="bookingForm" data-prompt-id="${promptId}">
                                <p><small>Please <b>select slot</b></small></p>
                                <div class="input-group align-items-center flex-nowrap mb-2">
                                    <input type="date" id="bookingDate_${promptId}" class="form-control" placeholder="Select date" min="${todayDate}">
                                    <input type="time" id="bookingTime_${promptId}" class="form-control" placeholder="Select time">
                                </div>
            
                                <p><small>What's your <b>name & email</b>?</small></p>
                                <div class="form-group">
                                    <input type="text" id="bookingName_${promptId}" value ="${firstName} ${lastName}" class="form-control" placeholder="Name">
                                    <input type="email" id="bookingEmail_${promptId}" value ="${email}" "phone" class="form-control mt-1" placeholder="Email">
                                    <input type="text" id="bookingPhone_${promptId}"  value ="${phone}" class="form-control mt-1" placeholder="Phone">
                                </div>
                                <button type="submit" class="btn_chatbx_fill w-100 mt-2">Send</button>
                            </form>
                        </div>
                    </div>`;
                shadowRoot.querySelector('.chatbx_response').innerHTML += bookingFormHtml;
                console.log('Booking form HTML added to DOM');
                console.log('Form element found:', shadowRoot.querySelector(`#${uniqueFormId}`));
                
                shadowRoot.querySelector('.chatbx_window').scrollTop = shadowRoot.querySelector('.chatbx_window').scrollHeight;
            
                // Attach form submission handler via delegation
                shadowRoot.querySelector('.chatbx_response').addEventListener('submit', (event) => {
                    const form = event.target;
            
                    // Ensure only the correct booking form is targeted
                    if (form.id === `form_${promptId}`) {
                        event.preventDefault(); // Prevent default form submission
                        handleBookingSubmission(form, promptId); // Pass the form and promptId for validation and processing
                    }
                });
                initializeCarousel();
                bindButtonListeners();
            }
            
            function handleBookingSubmission(form, promptId) {
                // Get form field values
                const bookingDate = shadowRoot.querySelector(`#bookingDate_${promptId}`).value.trim();
                const bookingTime = shadowRoot.querySelector(`#bookingTime_${promptId}`).value.trim();
                const bookingName = shadowRoot.querySelector(`#bookingName_${promptId}`).value.trim();
                const bookingEmail = shadowRoot.querySelector(`#bookingEmail_${promptId}`).value.trim();
                const bookingPhone = shadowRoot.querySelector(`#bookingPhone_${promptId}`).value.trim();
            
                // Reset validation styles
                form.querySelectorAll('.form-control').forEach((input) => {
                    input.classList.remove('error');
                });
            
                // Validation
                let isValid = true;
            
                if (!bookingDate) {
                    isValid = false;
                    shadowRoot.querySelector(`#bookingDate_${promptId}`).classList.add('is-invalid');
                }

                if (!bookingPhone) {
                    isValid = false;
                    shadowRoot.querySelector(`#bookingPhone_${promptId}`).classList.add('is-invalid');
                }
            
                if (!bookingTime) {
                    isValid = false;
                    shadowRoot.querySelector(`#bookingTime_${promptId}`).classList.add('is-invalid');
                }
            
                if (!bookingName) {
                    isValid = false;
                    shadowRoot.querySelector(`#bookingName_${promptId}`).classList.add('is-invalid');
                }
            
                if (!bookingEmail || !validateEmail(bookingEmail)) {
                    isValid = false;
                    shadowRoot.querySelector(`#bookingEmail_${promptId}`).classList.add('is-invalid');
                }
            
                if (!isValid) return; // Stop if validation fails
            
                // Prepare booking data
                const bookingData = {
                    booking_date: bookingDate,
                    booking_time: bookingTime,
                    name: bookingName,
                    email: bookingEmail,
                    phone_number: bookingPhone,
                    dealer_id: userId, // Assuming `userId` is defined in your script
                    conversation_id: conversation_id, // Assuming `conversation_id` is defined
                    // Page information
                    current_url: window.location.href,
                    page_title: document.title,
                    referrer: document.referrer || '',
                };
            
                // Call API to save booking data
                saveBookingData(bookingData, promptId);
            }
            
            function validateEmail(email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return emailRegex.test(email);
            }
            
            function saveBookingData(bookingData, promptId) {
                // Replace with your actual API endpoint
                const apiUrl = `${window.baseurl}api/bookings`;
                const loaderOverlay = shadowRoot.getElementById('widget_loader-overlay');
                loaderOverlay.style.display = "flex";
                fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bookingData),
                })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    return response.json();
                })
                .then((data) => {
                    if (data.success) {
                        // Format the booking data for display
                        const successMessageHtml = `
                            <div class="chatbx_msg_r" style="display:block;">
                                <p class="mb-1"><small>Your appointment has been booked. Here are the details -</small></p>
                                <small class="text-start">
                                    <b>Date: </b>${bookingData.booking_date}<br>
                                    <b>Time: </b>${bookingData.booking_time}<br>
                                    <b>Name: </b>${bookingData.name}<br>
                                    <b>Email: </b>${bookingData.email}<br>
                                    <b>Phone: </b>${bookingData.phone_number}<br>
                                </small>
                            </div>`;
                        booking =1;
                        const existingCustomer = localStorage.getItem('chatbotRegisteredCustomer');
    
                    // Only store if we don't have customer data yet
                        if (!existingCustomer && data.data) {
                            // Get form values
                            const name =bookingData.name
                            
                            const email = bookingData.email ;
                            const phone = bookingData.phone_number ;
                            customerId = data.data.user_id ;
                            const customerData = {
                                customerId: data.data.user_id ,
                                name,
                                email,
                                phone,
                                booking_date: bookingData.booking_date,
                                booking_time: bookingData.booking_time,
                                registrationDate: new Date().toISOString(),
                                vehicleInfo: {
                                    vin: data.data.vin || '',
                                    make: data.data.make || '',
                                    model: data.data.model || '',
                                    year: data.data.year || ''
                                }
                            };
                            
                            localStorage.setItem('chatbotRegisteredCustomer', JSON.stringify(customerData));
                        }
                        booking_id = data.data.id;
                        // Disable the form
                        disableForm(promptId);
                        
        
                        // Append the success message to the chat
                        shadowRoot.querySelector('.chatbx_response').innerHTML += successMessageHtml;
                        shadowRoot.querySelector('.chatbx_window').scrollTop = shadowRoot.querySelector('.chatbx_window').scrollHeight;
        
                        console.log('Booking saved successfully:', data);
                    } else {
                        // Display failure message in chat
                        const failureMessageHtml = `
                            <div class="chatbx_msg_r">
                                <small>Failed to save booking. Please try again.</small>
                                <span class="ch_time">${getCurrentTime()}</span>
                            </div>`;
                        shadowRoot.querySelector('.chatbx_response').innerHTML += failureMessageHtml;
                        shadowRoot.querySelector('.chatbx_window').scrollTop = shadowRoot.querySelector('.chatbx_window').scrollHeight;
        
                        console.warn('API responded with failure:', data);
                    }
                })
                .catch((error) => {
                    console.error('Error saving booking:', error);
        
                    // Display error message in chat
                    const errorMessageHtml = `
                        <div class="chatbx_msg_r">
                            <small>An error occurred. Please try again later.</small>
                            <span class="ch_time">${getCurrentTime()}</span>
                        </div>`;
                    shadowRoot.querySelector('.chatbx_response').innerHTML += errorMessageHtml;
                    shadowRoot.querySelector('.chatbx_window').scrollTop = shadowRoot.querySelector('.chatbx_window').scrollHeight;
                }) 
                .finally(() => {
                    initializeCarousel();
                    bindButtonListeners();
                    loaderOverlay.style.display = "none";
                });                   
            }

            function disableForm(promptId) {
                const form = shadowRoot.querySelector(`#form_${promptId}`); // Select the form using the unique promptId
                if (form) {
                    // Disable all form fields and buttons
                    form.querySelectorAll('.form-control, button').forEach((field) => {
                        field.disabled = true;
                        field.classList.add('disabled'); // Optionally, add a disabled class for styling
                    });
            
                    // Optionally add a visual cue to indicate the form is disabled
                    form.insertAdjacentHTML(
                        'beforeend',
                        `<small class="form-disabled-message" style="color: gray; display: block; margin-top: 10px;">This form is now disabled.</small>`
                    );
                } else {
                    console.warn(`Form with ID form_${promptId} not found.`);
                }
            }
            
            function handleapicall(button){
                apiurl  = ($(button).attr('data_href'));
                shadowRoot.apiresult(apiurl);
                clickdata ={'conversion_id':conversation_id,action:'Explore_more','otherdetail':apiurl,'source':userId };
                triggerClickButton(clickdata);
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
            


            function displayErrorMessage(message) {
                const chatBoxResponse = shadowRoot.querySelector('.chatbx_response');
                chatBoxResponse.innerHTML += `
                    <div class="chatbx_msg_l">
                        <small>${message}</small><span class="ch_time">${getCurrentTime()}</span>
                        <a id="resendBtn" class="px-2 resend_btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-rotate-cw"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                        &nbsp;Resend</a>
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
                        navText: [
                            '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-left"><polyline points="15 18 9 12 15 6"></polyline></svg>',
                            '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-right"><polyline points="9 18 15 12 9 6"></polyline></svg>'
                        ]
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

                    const url = window.baseurl + `api/vehicledetail/${vehicle.id ?? ''}`; // Ensure baseurl is defined
                    const loaderOverlay = shadowRoot.getElementById('widget_loader-overlay');
                    loaderOverlay.style.display = "flex";
                    
                    fetch(url, {
                        method: 'GET',
                    })
                    .then(response => response.json())
                    .then(data => {
                        let vehicle = data.listings[0];
                        console.log(vehicle);
                    // Container for vehicle details
                            const container = shadowRoot.getElementById('chatbx_car_details');
                            if (vehicle && vehicle.extra && vehicle.extra.high_value_features) {
                                // Iterate over each feature in the array associated with the key
                                vehicle.extra.high_value_features.forEach(item => {
                                    let category = item;
                                    let description = item;
                                    // Initialize the category array if it doesn't exist
                                    if (!organizedFeatures[category]) {
                                        organizedFeatures[category] = [];
                                    }
                                    // Append the description to the category array
                                    organizedFeatures[category].push(description);
                                });
                            }
                        
                            // Extract data from the vehicle object
                            const image = vehicle?.['media']?.['photo_links']?.[0] ?? '';
                            const title = `${vehicle?.['build']?.['year'] ?? ''} ${vehicle?.['build']?.['make'] ?? ''} ${vehicle?.['build']?.['model'] ?? ''}`;
                            const location = `${vehicle?.['dealer']?.['city'] ?? ''}, ${vehicle?.['dealer']?.['state'] ?? ''}`;
                            const price = vehicle?.['price'] ? `$${Math.floor(vehicle['price']).toLocaleString('en-US')}` : 'N/A';
                            let certifiedBadge ='';
                            if (vehicle.is_certified) {                            
                                certifiedBadge = ` <div class="certified_badge">
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffd43b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-award"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>
                                                        </div>`;                                
                            }

                            const { customerId = '', email = '', phone = '', firstName = '', lastName = '' } = JSON.parse(localStorage.getItem('chatbotRegisteredCustomer') || '{}');
                            const vehicleDetailsHtml = `
                            <div class="position-relative chatbx_req_info_inn">
                                <div class="chatbx_subhead position-relative py-0 px-0">
                                        <a class="ms-auto chatbxfulldetail_show_btn">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-down"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                        </a>
                                </div>
                        
                                <div class="row">
                                    <div class="col col-12">
                                        <div class="chatbx_detail_full">
                                            <div class="position-relative car_details_slider">
                                                <div class="main_slider">${certifiedBadge}
                                                    <!-- All photos -->
                                                     <!-- <div class="view_all_photos">
                                                        <a class="all_photos">All Photos</a>
                                                    </div> -->
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
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-map-pin"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                                                                    <span>${location}</span>
                                                                </div>
                                                                ${vehicle['dealer']['call_track_number'] ? `
                                                                <div class="car_loc ms-0 w-100 mt-1">
                                                                    <a href="tel:${vehicle['dealer']['call_track_number']}" class="btn btn_blue ms-auto click_call_btn">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-phone"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                                                        <span>${vehicle['dealer']['call_track_number']}</span>
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
                                                                <a href="sms:+${vehicle['dealer']['call_track_sms']}&&body=${encodeURIComponent(location.href)}" id="share-sms" class="d-md-none btn btn_blue ms-auto">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-message-circle"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                                                                    <span>Text Message</span>
                                                                </a>` : ''}
                                                            </div>
                                                        </div>
                                                            <a href="${vehicle['vdp_url'] ?? ''}?utm_source=Autopulse+&utm_medium=Autopulse&utm_campaign=Autos" target="_blank" class="btn_chatbx_fill w-100 view_dealer_website">View Dealer Website</a>
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
                                                            <input type="hidden" name="vid" id="vid"  value="${vehicle['id']}">
                                                               <input type="hidden" name="vin" id="vin"  value="${vehicle['vin']}">
                                                            <input type="hidden" name="latitude" id="request_latitude" value="">
                                                            <input type="hidden" name="longitude" id="request_longitude" value="">
                                                            <input type="hidden" name="city" id="request_city" value="">
                                                            <input type="hidden" name="country" id="request_country" value="">
                                                                <input type="hidden" name="dealerId" id="rqeust_dealerId" value="${userId}">
                                                            <div class="row g-2">
                                                                <div class="col col-6">
                                                                    <div class="position-relative">
                                                                        <input type="text" name="first_name" id="first_name" value="${firstName}" placeholder="First Name" class="form-control required">
                                                                    </div> 
                                                                </div>
                                                                <div class="col col-6">
                                                                    <div class="position-relative">
                                                                        <input type="text" name="last_name" id="last_name" value="${lastName}" placeholder="Last Name" class="form-control required">                                            
                                                                    </div> 
                                                                </div>
                                                                <div class="col col-12">
                                                                    <div class="position-relative">
                                                                        <input type="text"  placeholder="Zip code" name="zip_code" id="request_zip_code" class="form-control required">
                                                                    </div> 
                                                                </div>
                                                                <div class="col col-12">
                                                                    <div class="position-relative">
                                                                        <input type="text" name="email" id="regvinEmail" placeholder="Email"  value="${email}" class="form-control required">
                                                                    </div> 
                                                                </div>
                                                                <div class="col col-12">
                                                                    <div class="position-relative">
                                                                        <input type="text" name ="phone_number" id="regphone_number" placeholder="Phone" value="${phone}" class="form-control required">
                                                                        <input type="hidden" id="request_vin" name ="vin" placeholder="Phone" value="${vehicle['vin']}" class="form-control required">
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
                                                                        <p><span>${vehicle['vin'] ?? 'NA'}</span>
                                                                        <svg class="text_primary cursor-pointer copyButton" id="copyButton" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-copy"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                                                        </p>
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
                                                                <button class="accordion-button ${i !== 0 ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#${key.replace(/[^a-zA-Z0-9_]/g, '_')}" aria-expanded="${i === 0}" aria-controls="${key.replace(/[^a-zA-Z0-9_]/g, '_')}">
                                                                    ${key}
                                                                </button>
                                                            </h2>
                                                            <div id="${key.replace(/[^a-zA-Z0-9_]/g, '_')}" class="accordion-collapse collapse ${i === 0 ? 'show' : ''}" aria-labelledby="${key}-heading" data-bs-parent="#detailedFeatures">
                                                                <div class="accordion-body">
                                                                    <div class="features_list">
                                                                        <ul class="row">
                                                                            ${value.map(item => `
                                                                            <li class="col col-12">
                                                                                <div class="feature_inn">
                                                                                    <p>
                                                                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-check-circle"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                                                                        ${item}</p>
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
                        clickdata ={'conversion_id':conversation_id,action:'View_Vehicle',vin:vehicle['vin'],'source':userId };

                        triggerClickButton(clickdata);

                        const viewDealerWebsiteBtn = shadowRoot.querySelector('.view_dealer_website');
                        if (viewDealerWebsiteBtn) {
                            viewDealerWebsiteBtn.addEventListener('click', function() {
                                let data = {
                                    'conversion_id': conversation_id,
                                    action: 'Visit_dealer_website',
                                    vin: vehicle['vin'],
                                    source: userId
                                };
                                triggerClickButton(data);
                            });
                        } })
                        .catch(error => console.error('Error:', error))
                        .finally(() => {
                            loaderOverlay.style.display = "none";
                        });
            }
            
            function triggerClickButton(data){
                
                // Add page information to the data
                const enrichedData = {
                    ...data,
                    current_url: window.location.href,
                    page_title: document.title,
                    referrer: document.referrer || '',
                    timestamp: new Date().toISOString()
                };
                
                // Define the API endpoint
                const apiUrl = baseurl + 'api/bot-click-action';
            
                // Send the organized features via a POST request using fetch
                fetch(apiUrl, {
                    method: 'POST', // HTTP method
                    headers: {
                        'Content-Type': 'application/json', // Content-Type for JSON
                    },
                    body: JSON.stringify(enrichedData)
                })
                .then(response => response.json()) // Parse the JSON response
                .then(data => {
                    // Handle the response from the API
                    console.log('Success:', data);
                })
                .catch((error) => {
                    // Handle errors in the request
                    console.error('Error:', error);
                });
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
                    navText: ['<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-left"><polyline points="15 18 9 12 15 6"></polyline></svg>', 
                            '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-right"><polyline points="9 18 15 12 9 6"></polyline></svg>'],
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

                // Ensure both elements exist
                if (!chatbxMain || !exploreMain) return;

                if (!chatbxMain.classList.contains('fullScreen') && exploreMain.classList.contains('listingCarsOpen')) {
                    setTimeout(function() {
                        exploreMain.style.height = exploreMain.clientHeight + 'px';
                    }, 400);
                }
            }

            // Submit Form Helpers
            window.addEventListener('beforeunload', function(event) {
                // API URL for browser close/reload event
                const url = `${window.baseurl}api/logout-action`; // Replace with your specific endpoint
                
                // Data to send to API
                if( conversation_id){
                    const data = {
                        'userId': userId, // Assuming userId is defined in your script
                        'conversion_id': conversation_id,
                       
                    };
                    closechaturl(data);
                    event.preventDefault();
                    event.returnValue = '';
                }
            });
            function closechaturl(data){                
                // Define the API endpoint
                const url = baseurl + 'api/close_conversion';            
                const params = new URLSearchParams(data).toString();
                navigator.sendBeacon(`${url}?${params}`);                
            }
           
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
                    const existingCustomer = localStorage.getItem('chatbotRegisteredCustomer');        
                        // Only store if we don't have customer data yet
                    if (!existingCustomer && data.data) {
                        // Get form values
                        const firstName = shadowRoot.getElementById('first_name')?.value || '';
                        const lastName = shadowRoot.getElementById('last_name')?.value || '';
                        const email = shadowRoot.getElementById('regvinEmail')?.value || '';
                        const phone = shadowRoot.getElementById('regphone_number')?.value || '';
                        customerId = data.data.user_id ;
                        const customerData = {
                            customerId: data.data.user_id ,
                            firstName,
                            lastName,
                            email,
                            phone,
                            registrationDate: new Date().toISOString(),
                            vehicleInfo: {
                                vin: data.data.vin || '',
                                make: data.data.make || '',
                                model: data.data.model || '',
                                year: data.data.year || ''
                            }
                        };                        
                        localStorage.setItem('chatbotRegisteredCustomer', JSON.stringify(customerData));
                    }            
                    // Show success message below the form
                    showSuccessMessage("Your request has been submitted successfully.", formElement, shadowRoot);
                })
                .catch(error => {
                    console.error('Error submitting form:', error);
                    loaderOverlay.style.display = "none";
                });
                vin = shadowRoot.getElementById('request_vin');               
                let data ={'conversion_id':conversation_id,action:'Vin_Reqeust_form','source':userId,'vin':vin};
                triggerClickButton(data);               
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
                    let data = {
                        'conversion_id': conversation_id,
                        action: 'vin_copy',
                        vin: textToCopy,
                        source: userId
                    };
                    triggerClickButton(data);
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
                var myurl =baseurl+'api/vehicle?' + params;        
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
                    loadScript('https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/owl.carousel.min.js', initializeChatbot);
                });
            });
        });
    });
})();