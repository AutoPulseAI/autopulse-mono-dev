(function() {
    document.addEventListener("DOMContentLoaded", function() {
        // Create a container for the chatbot widget
        const widgetContainer = document.createElement('div');
        widgetContainer.id = 'chatbot-widget';
        document.body.appendChild(widgetContainer);
        const chatbotWidget = document.getElementById('chatbot-widget_user');
        const userId = chatbotWidget.getAttribute('data-user-id');
        let welcomemsg = ''
        //console.log(userId);
        let context;
        let conversation_id;
        let lastUserInput = '';  // Store the last user input

        // Load jQuery, Bootstrap, and chat.css if they're not already loaded
        if (typeof jQuery === 'undefined') {
            loadScript('https://code.jquery.com/jquery-3.7.1.min.js', function() {
                loadCSS('https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css', function() {
                    loadCSS('https://autopulse.ai/assets/css/gallary.css', function() {
                        loadCSS('https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.5.0/nouislider.min.css', function() {
                            loadCSS('https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/assets/owl.carousel.min.css', function() {
                                loadCSS('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css', function() {
                                    loadScript('https://autopulse.ai/assets/js/gallary.js', function() {
                                        loadScript('https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.6/dist/umd/popper.min.js', function() {
                                            loadScript('https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.min.js', initializeWidget);
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
                

           
        } else {
          
            loadCSS('https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css', function() {
                loadCSS('https://autopulse.ai/assets/css/gallary.css', function() {
                    loadCSS('https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.5.0/nouislider.min.css', function() {
                        
                        loadCSS('https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/assets/owl.carousel.min.css', function() {
                            loadCSS('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css', function() {
                                loadScript('https://autopulse.ai/assets/js/gallary.js', function() {
                                    loadScript('https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.6/dist/umd/popper.min.js', function() {
                                        loadScript('https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.min.js', initializeWidget);
                                    });
                                });
                            });
                        });
                    });
                });
            });
         
           
        }

        function initializeWidget() {
            // Function to inject styles
            function injectStyles(css) {
                const style = document.createElement('style');
                style.type = 'text/css';
                style.appendChild(document.createTextNode(css));
                document.head.appendChild(style);
            }

            // Inject the HTML structure
            widgetContainer.innerHTML = `
                <div class="position-relative chatboxAi">
                    <div class="chatboxO">
                        <div class="banner_chatbox_o">
                            <a class="chatboxO_a">
                                <span class="banner_chatbox_text" id="chatbot-name">Ask a question with Autopulse</span>
                                <span class="banner_chatbox_icon">
                                    <img src="https://example.com/assets/images/chatbxSearch.png" id="chatbot-logo" alt="chat" class="img-fluid">
                                </span>
                            </a>
                        </div>
                    </div>

                    <div class="chatbx_main">
                        <div class="chatbx_secondary chatbx_car_details">            
                            <div class="chatbx_fulldetail_info chatbxdetails_show" id="chatbx_car_details"></div>
                        </div>

                        <div class="chatbx_primary">
                            <div class="chatbx_head">
                                <img src="http://127.0.0.1:8000/assets/images/auto/auto_ai.png" alt="img" id="chatbot-auto-logo">
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
                        <div id="widget_loader-overlay" class="loader-overlay" style="display: none;">
                            <div class="loader"></div>
                        </div>
                    </div>
                </div>
            `;

            // Add necessary inline styles
            injectStyles(`
                :root{
                --chat_blue: #4272FF;

                --primary: #FF4605;
                --primary-light: #FFF0EB;
                --black: #0F141E;
                --dark: #222732;
                --dark-light: #2F3B48;
                --secondary: #99A1B2;
                --gray: #EFF3FA;
                --white: #ffffff;
                --border-color: rgba(52, 59, 74, 0.05);
                --red: #ff0000;
                --green: #198754;
                --card-icons: #a7a7a7;
                --tw: #1fbed6;
                --fb: #1877F2;
                --yb: #CD201F;
                --ln: #0077b5;
                --wh: #25d366;
                --yellow: #FFFAEC;
                --blue: #43a9e7;

                --brown: #964B00;
            }

            .chatboxAi .form-control:focus, .chatboxAi .btn-check:focus+.btn, .chatboxAi .btn:focus, .form-select:focus {
                background-color: unset;
                border-color: unset;
                outline: 0;
                box-shadow: none;
            }
            .chatboxAi a {
                text-decoration: unset !important;
                cursor: pointer !important;
            }
            :focus-visible {
                outline: none !important;
            }
            .chatboxAi .text_secondary {
                color: var(--secondary);
            }

            .chatboxAi .chatbx_main{
                position: fixed;
                right: 16px;
                bottom: 16px;
                background: #fff;
                border: 1px solid rgba(36, 39, 44, .1);
                box-shadow: 0px 6px 10px rgba(0, 0, 0, .05);
                border-radius: 16px;
                display: flex;
                overflow: hidden;
                visibility: hidden;
                z-index: 1040;
            }
            .chatboxAi .chatbx_main.chat_open.fullScreen{
                border-radius: 0;
            }
            .chatboxAi .chatbx_main.chat_open{
                visibility:visible;
            }
            .chatboxAi .chatbx_car_card_main .owl-stage{
                transition: unset !important;
            }
            .chatboxAi .chatbx_primary, .chatboxAi .chatbx_main.collapsed .chatbx_secondary, .chatboxAi .chatbx_main.chat_open.auth_true .chatbx_secondary{
                position: relative;
                width: 350px;
                height: 550px;
                background-color: var(--white);
            }
            .chatboxAi .chatbx_primary{
                z-index: 5;
            }
            .chatboxAi .chatbx_secondary .chatbx_car_details_main{
                position: relative;
                border-right: 1px solid rgba(36, 39, 44, .1);

            }
            .chatboxAi .chatbx_main .chatbx_secondary .chatbx_car_details_main{
                position: absolute;
                top: 0;
                bottom: 0;
                left: 0;
                right: 0;
                width: 0;
                background-color: var(--white);
                overflow: hidden;

            }
            .chatboxAi .chatbx_main.collapsed .chatbx_secondary .chatbx_car_details_main{
                width: 100%;
                overflow: unset;
            }

            .chatboxAi .chatbx_main.chat_open.auth_true .chatbx_history{
                width: 100%;
                background-color: var(--white);
            }
            .chatboxAi .hisbar{
                display: none;
            }

            .chatboxAi .chatbx_main.collapsed.fullScreen .chatbx_primary, .chatboxAi .chatbx_main.collapsed.fullScreen .chatbx_secondary, .chatboxAi .chatbx_main.fullScreen .chatbx_secondary{
                height: 100% !important;
                border-left: 1px solid rgba(36, 39, 44, .1);
            }

            .chatboxAi .chatbx_main .chatbx_secondary .chatbx_car_details{
                opacity: 0;
                /* -webkit-transition: all 1s ease;
                -moz-transition: all 1s ease;
                transition: all 1s ease; */
            }
            .chatboxAi .chatbx_main.collapsed .chatbx_secondary .chatbx_car_details{
                opacity: 1;
            }

            .chatboxAi .chatbx_head{
                position: relative;
                display: flex;
                align-items: center;
                background-color: var(--dark);
            }
            .chatboxAi .chatbx_head img{
                width: auto;
                max-height: 24px;
                object-fit: contain;
            }
            .chatboxAi .chatbx_primary .chatbx_head a{
                color: var(--white);
            }
            .chatboxAi .chatbx_window{
                position: relative;
                /* height: 450px; */
                overflow-y: auto ;
                overflow-x: hidden ;
            }
            .chatboxAi .chatbx_main.fullScreen .chatbx_response {
                height: 100%;
                border-right: 1px solid rgba(36, 39, 44, .1);
            }
            .chatboxAi .chatbx_response .chatbx_msg_l, .chatboxAi .chatbx_car_card_main, .chatboxAi .chatbx_msg_l.chatbx_msg_loader_inn{
                position: relative;
                margin-left: 32px;
                display: block;
            }
            .chatboxAi .chatbx_response .chatbx_msg_l:before, .chatboxAi .chatbx_car_card_main:before, .chatboxAi .chatbx_msg_l.chatbx_msg_loader_inn:before {
                content: '';
                background:url('../images/auto/auto_short.png');
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
            .chatboxAi .chatbx_response .chatbx_msg_r, .chatboxAi .chatbx_response .chatbx_msg_l, .chatboxAi .chatbx_msg_l.chatbx_msg_loader_inn {
                max-width: 82%;
                line-height: 18px;
                font-size: 15px;
                margin-bottom: 8px;
                display: block;
                position: relative;
            }
            .chatboxAi .chatbx_response .chatbx_msg_r small, .chatboxAi .chatbx_response .chatbx_msg_l small {
                padding: 8px;
                display: inline-block;
                position: relative;
            }
            .chatboxAi .chatbx_response .chatbx_msg_r span, .chatboxAi .chatbx_response .chatbx_msg_l span, .chatboxAi .chatbx_car_card_main span {
                font-size: 11px;
                color: var(--secondary);
                display: block;
                margin-top: 3px;
            }
            .chatboxAi .chatbx_response .chatbx_msg_r {
                margin-left: auto;
                text-align: end;
            }
            .chatboxAi .chatbx_response .chatbx_msg_r small {
                background-color: var(--primary-light);
                border-radius: 8px 0 8px 8px;
            }
            .chatboxAi .chatbx_response .chatbx_msg_l small {
                background-color: var(--gray);
                border-radius: 0 8px 8px 8px;
            }

            .chatboxAi .chatbx_car_card_main{
                position: relative;
                max-width: 83%;
                margin-bottom: 8px;
                display: block;
            }
            .chatboxAi .chatbx_car_card{
                position: relative;
                background: #fff;
                border: 1px solid rgba(36, 39, 44, .1);
                /* box-shadow: 0px 6px 10px rgba(0, 0, 0, .05); */
                border-radius: 16px;
                overflow: hidden;
                margin-right: 1px;
            }
            .chatboxAi .chatbx_car_card_main .owl-nav{
                margin-top: 8px;
                text-align: center;
            }
            .chatboxAi .chatbx_car_card_main .owl-nav button i {
                width: 36px;
                height: 36px;
                font-size: 15px;
                margin: 0 2px;
                display: flex;
                justify-content: center;
                align-items: center;
                border-radius: 50%;
            }
            .circular_nav .owl-nav button i {
                background-color: var(--gray);
                color: var(--dark-light);
                border: 1px solid var(--gray);
            }
            .circular_nav .owl-nav button:hover i {
                background-color: var(--primary-light);
                color: var(--primary);
                border-color: var(--primary);
            }

            .chatboxAi .chatbx_car_card img{
                position: relative;
                width: 100%;
                max-height: 165px;
            }
            .chatboxAi .chatbx_carcard_content{
                position: relative;
                padding: 8px;
            }
            .chatboxAi .chatbx_carcard_content h3{
                font-size: 15px;
                line-height: 20px;
                font-weight: 300;
                min-height: 42px;
                margin-bottom: 8px;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
            }
            .chatboxAi .chatbx_carcard_loc_price {
                display: flex;
                align-items: self-start;
            }
            .chatboxAi .chatbx_carcard_loc_price .chatbx_car_loc {
                display: flex;
                align-items: baseline;
                color: var(--secondary);
                font-size: 13px;
                font-weight: 400;
            }
            .chatboxAi .chatbx_carcard_loc_price h5 {
                font-size: 18px;
                font-weight: 800;
                margin-left: auto;
                margin-bottom: 0;
            }

            .chatboxAi .chatbx_carcard_btns .btn_chatbx_card{
                display: block;
                width: 100%;
                padding: 6px 12px;
                font-size: 14px;
                font-weight: 500;
                text-align: center;
                border-top: 1px solid rgba(36, 39, 44, .1);
                color: var(--primary);
            }
            .chatboxAi .chatbx_carcard_btns .btn_chatbx_card:hover{
                text-decoration: underline;
            }
            .chatboxAi .chatbx_input{
                position: relative;
                border-top: 1px solid rgba(36, 39, 44, .1);
            }
            .chatboxAi .chatbx_input a{
                color: var(--primary);
                cursor: pointer;
            }
            .chatboxAi .chatbx_input .form-control{
                padding-bottom: 8px;
            }
            .chatboxAi .chatbx_input small{
                font-size: 11px;
                line-height: 11px;
                padding-bottom: 6px;
                display: block;
                padding-left: 12px;
            }

            .chatboxAi .chatbx_head, .chatboxAi .chatbx_response, .chatboxAi .chatbx_fixed_btm, .chatboxAi .chatbx_head .btn_short, .chatboxAi .explore_main .explore_list, .chatboxAi .explore_main .explore_filters{
                padding: 12px;
            }
            .chatboxAi .chatbx_head, .chatboxAi .chatbx_response{
                overflow: hidden;
            }
            .explore_main{
                display: none;
            }
            .listing_cars_back{
                color: var(--dark-light);
            }
            .listingCarsOpen.explore_main{
                position: absolute;
                top: 0;
                bottom: 0;
                left: 0;
                right: 0;
                z-index: 300;
                background-color: var(--white);
                overflow-x: hidden;
                overflow-y: auto;
                display: block;
            }
            .explore_main .tags-container {
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
                margin-top: 8px;
            }
            .explore_main .tag {
                background-color: var(--white);
                border-radius: 30px;
                padding: 2px 6px;
                display: inline-block;
                font-size: 14px;
                margin-bottom: 5px;
                border: 1px solid var(--primary);
            }

            .explore_main .tag-remove {
                margin-left: 0.2rem;
                background-color: var(--red);
                text-decoration: none;
                cursor: pointer !important;
                color: var(--white) !important;
                height: 16px;
                width: 16px;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                line-height: 14px;
            }

            .pagination_main nav .pagination {
                margin: 0 auto;
            }

            .pagination_main {
                margin-top: 16px;
            }

            .pagination_main nav {
                display: flex;
            }

            .pagination_main .page-item {
                margin-right: 3px;
            }

            .pagination_main .page-item:first-child .page-link,
            .pagination_main .page-item:last-child .page-link {
                font-size: 20px;
                align-items: self-end;
            }

            .pagination_main .page-item .page-link {
                width: 26px;
                height: 26px;
                border-radius: 50% !important;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0;
                font-size: 13px;
            }

            .pagination_main .page-item.active .page-link {
                z-index: 3;
                color: #fff;
                background-color: var(--primary);
                border-color: var(--primary);
            }

            .pagination_main .page-link,
            .pagination_main .page-link:hover,
            .pagination_main .page-link:focus {
                color: var(--primary);
            }

            /* Btn */
            .chatboxAi .chatbx_fixed_btm{
                position: absolute;
                left: 0;
                right: 0;
                bottom: 0;
                text-align: center;
                background-color: var(--white);
            }
            .chatboxAi .btn_chatbx{
                position: relative;
                border: 1px solid var(--primary);
                border-radius: 7px;
                padding: 6px 12px;
                font-size: 14px;
                font-weight: 500;
                color: var(--primary);
                display: inline-block;
                cursor: pointer !important;
                text-align: center;
            }
            .chatboxAi .btn_chatbx:hover, .chatboxAi .btn_chatbx:focus{
                border: 1px solid var(--primary);
                background-color: var(--primary);
                color: var(--white);
            }

            .chatboxAi .btn_chatbx_fill{
                position: relative;
                border: 1px solid var(--primary);
                border-radius: 7px;
                padding: 6px 12px;
                font-size: 14px;
                font-weight: 500;
                color: var(--white);
                background-color: var(--primary);
                display: inline-block;
                cursor: pointer !important;
                text-align: center;
            }
            .chatboxAi .btn_chatbx_fill:hover, .btn_chatbx_fill:focus{
                border: 1px solid var(--primary);
                background-color: var(--white);
                color: var(--primary);
            }


            /* Car Details */
            .chatboxAi .chatbx_car_details .chatbx_subhead{
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                background-color: transparent;
                z-index: 1;
            }
            .chatboxAi .chatbx_car_details .chatbx_subhead a i{
                display: flex;
                align-items: center;
                justify-content: center;
                background-color: var(--white);
                height: 32px;
                width: 32px;
                font-size: 13px;
                border-radius: 50%;
                color: var(--dark-light);
            }
            .chatboxAi .chatbx_car_details {
                position: relative;
            }
            .chatboxAi .chatbx_car_details img{
                width: 100%;
                max-height: 200px;
                object-fit: cover;
            }
            .chatboxAi .chatbx_cardetails_content{
                padding: 16px 12px;
            }
            .chatboxAi .chatbx_cardetails_content h3{
                font-size: 18px;
                font-weight: 700;
            }
            .chatboxAi .chatbx_cardetails_loc {
                color: var(--secondary);
                font-size: 13px;
                font-weight: 400;
            }

            .chatboxAi .chatbx_cardetails_specs{
                margin: 12px 0;
            }
            .chatboxAi .chatbx_cardetails_specs ul{
                padding: 0;
                margin: 0;
            }
            .chatboxAi .chatbx_cardetails_specs ul{
                list-style: none;
            }
            .chatboxAi .chatbx_cardetails_spec{
                margin-bottom: 6px;
            }
            .chatboxAi .chatbx_cardetails_spec i{
                color: var(--primary);
                margin-right: 4px;
                font-size: 15px;
                display: inline-block;
                vertical-align: top;
                line-height: 24px;
            }
            .chatboxAi .chatbx_cardetails_spec p small{
                color: var(--secondary);
                font-size: 11px;
                font-weight: 400;
            }
            .chatboxAi .chatbx_cardetails_spec p{
                font-size: 13px;
                font-weight: 400;
                margin-bottom: 0;
                line-height: 18px;
            }

            .chatboxAi .chatbx_cardetails_price{
                position: relative;
                text-align: center;
            }
            .chatboxAi .chatbx_cardetails_price h5{
                position: relative;
                display: inline-flex;
                align-items: center;
                margin-bottom: 15px;
            }
            .chatboxAi .chatbx_cardetails_price small{
                color: var(--secondary);
                font-size: 13px;
                font-weight: 400;
            }
            .chatboxAi .chatbx_cardetails_price span{
                font-size: 18px;
                font-weight: 800;
                margin-left: auto;
                margin-bottom: 0;
            }

            .chatboxAi .chatbx_cardetails_btn{
                position: relative;
                width: 86%;
                margin: 0 auto;
            }

            /* Full Screen */
            .chatboxAi .chatbx_main.fullScreen{
                left: 0;
                right: 0;
                top: 0;
                bottom: 0;
                /* width: 90%; */
                margin: 0 auto;
                justify-content: center;
                background-color: var(--gray);
            }
            .chatboxAi .chatbx_main.fullScreen .chatbx_primary{
                height: 100%;
            }
            .chatboxAi .chatbx_main.fullScreen .chatbx_primary, .chatboxAi .chatbx_main.fullScreen .chatbx_car_card_main {
                width: 97%;
                max-width: 97%;
            }


            /* Req Info */
            .chatboxAi .chatbx_req_info, .chatbx_fulldetail_info, .chatbx_fulldetail_info {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                background-color: var(--white);
                z-index: 15;
                height: 100%;
                display: none;
            }
            .chatboxAi .chatbx_req_info .chatbx_req_info_inn {
                display: none;
                padding: 16px 12px;
            }
            .chatboxAi .chatbx_req_info.chatbxreq_show, .chatboxAi .chatbx_fulldetail_info.chatbxdetails_show{
                display: block;

            }
            .chatboxAi .chatboxAi .chatbx_req_info.chatbxreq_show .chatbx_req_info_inn {
                display: block;
            }
            .chatboxAi .chatbx_req_info .details_req_info{
                font-size: 15px;
            }
            .chatboxAi .req_in_border {
                border: 0;
                border-bottom: 1px solid var(--secondary);
                background-color: rgba(239, 243, 250, 0.3);
            }
            .chatboxAi .chatbx_req_info .details_req_info .req_in_border.req_in_wsm {
                width: 90px;
            }
            .chatboxAi .chatbx_req_info .details_req_info span {
                line-height: 32px;
            }
            .chatboxAi .chatbx_main.collapsed.fullScreen .chatbx_secondary{
                height: 100%;
            }

            /* Chat open btn */
            .chatboxAi .chatboxO{
                position: fixed;
                bottom: 30px;
                right: 30px;
                z-index: 1040;
            }
            .chatboxAi .banner_chatbox_icon{
                width: 40px;
                height: 40px;
                background-color: var(--chat_blue);
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                color: var(--white);
            }
            .chatboxAi .banner_chatbox_icon{
                width: 56px;
                height: 56px;
                border: 6px solid var(--white);
            }

            /* banner chat open */
            .chatboxAi .banner_chatbox_o a{
                display: flex;
                align-items: start;
                margin-top: 16px;
            }
            .chatboxAi .chatboxO .banner_chatbox_o a{
                align-items: center;
                display: block;
            }
            .chatboxAi .banner_chatbox_text{
                position: relative;
                background-color: var(--chat_blue);
                color: var(--white);
                font-size: 20px;
                padding: 5px 10px;
                border-radius: 0 6px 6px 0;
                margin-left: 12px;
                max-width: 80%;
            }
            .chatboxAi .banner_chatbox_text:before {
                content: '';
                width: 0;
                height: 0;
                border-top: 7px solid transparent;
                border-bottom: 7px solid transparent;
                border-right: 7px solid var(--chat_blue);
                display: inline-block;
                position: absolute;
                left: -7px;
                top: 18px;
            }
            .chatboxAi .chatboxO .banner_chatbox_text{
                border-radius: 6px 0 0 6px;
                margin-left: 0;
                margin-right: 12px;
                font-size: 14px;
            }
            .chatboxAi .chatboxO .banner_chatbox_text:before{
                display: none;
            }
            .chatboxAi .chatboxO .banner_chatbox_text:after {
                content: '';
                width: 0;
                height: 0;
                border-left: 7px solid transparent;
                border-right: 7px solid transparent;
                border-top: 7px solid var(--chat_blue);
                display: inline-block;
                position: absolute;
                right: 22px;
                bottom: -7px;
            }

            /* History */
            .chatboxAi .chatbx_history_head{
                position: relative;
                /* background-color: var(--gray); */
                padding: 12px;
            }
            .chatboxAi .chatbx_history_head .search_chat{
                float: right;
            }
            .chatboxAi .chatbx_history_head .input-group{
                padding-top: 12px;
            }
            .chatboxAi .chatbx_history_head .input-group .form-control{
                border-color: #6c757d !important;
                background: transparent !important;
            }
            .chatboxAi .chatbx_history_head .input-group .form-control, .chatbx_history_head .input-group button{
                border-radius: 20px;
            }

            .chatboxAi .new_chat_btn {
                background-color: var(--gray);
                color: var(--dark) !important;
                padding: 8px 15px;
                border-radius: 20px;
                font-size: 14px;
                border: 1px solid var(--gray);
            }
            .chatboxAi .search_chat{
                color: var(--dark) !important;
            }
            .chatboxAi .chatbx_history_list .chatbx_history_list_sorted {
                margin-bottom: 12px;
            }
            .chatboxAi .chatbx_history_list .chatbx_history_list_sorted:last-child{
                margin-bottom: 0;
            }
            .chatboxAi .chatbx_history_list .chatbx_history_list_sorted p {
                margin-bottom: 6px;
            }
            .chatboxAi .chatbx_history_list .chatbx_history_list_sorted p{
                color: var(--secondary);
                font-size: 11px;
                font-weight: 400;
            }
            .chatboxAi .chatbx_history_list {
                position: relative;
                padding: 12px;
                overflow-y: auto;
            }
            .chatboxAi .chatbx_history_list .chatbx_history_list_sorted a{
                font-size: 13px;
                font-weight: 400;
                margin-bottom: 0;
                line-height: 18px;
                white-space: nowrap;
                text-overflow: ellipsis;
                overflow: hidden;
                color: var(--dark);
                display: block;
                padding: 6px;
            }
            .chatboxAi .chatbx_history_list .chatbx_history_list_sorted a:hover{
                background-color: var(--gray);
            }


            /* Chatbox login header */
            .chatboxAi .chatbx_login_btn{
                background-color: var(--white);
                color: var(--dark) !important;
                padding: 2px 10px;
                border-radius: 15px;
                font-size: 14px;
                border: 1px solid var(--white);

            }
            .chatboxAi .chatbx_login_btn:hover{
                background-color: transparent;
                color: var(--white) !important;
            }

            /* loading */
            .chatboxAi .chatbx_msg_loader {
                position: relative;
                padding: 0 12px;
            }
            .chatboxAi .chatbx_msg_loader_inn{
                position: relative;
                background-color: var(--gray);
                padding: 10px 12px;
                border-radius: 0 8px 8px 8px;
                display: flex !important;
                align-items: center;
            }
            .chatboxAi .dot-pulse {
                position: relative;
                left: -9999px;
                width: 5px;
                height: 5px;
                border-radius: 5px;
                background-color: var(--secondary);
                color: var(--secondary);
                box-shadow: 9999px 0 0 -5px;
                animation: dot-pulse 1.5s infinite linear;
                animation-delay: 0.25s;
                margin-left: 26px;
            }
            .chatboxAi .dot-pulse::before, .dot-pulse::after {
                content: "";
                display: inline-block;
                position: absolute;
                top: 0;
                width: 5px;
                height: 5px;
                border-radius: 5px;
                background-color: var(--secondary);
                color: var(--secondary);
            }
            .chatboxAi .dot-pulse::before {
                box-shadow: 9984px 0 0 -5px;
                animation: dot-pulse-before 1.5s infinite linear;
                animation-delay: 0s;
            }
            .chatboxAi .dot-pulse::after {
                box-shadow: 10014px 0 0 -5px;
                animation: dot-pulse-after 1.5s infinite linear;
                animation-delay: 0.5s;
            }
            
            @keyframes dot-pulse-before {
                0% {
                box-shadow: 9984px 0 0 -5px;
                }
                30% {
                box-shadow: 9984px 0 0 2px;
                }
                60%, 100% {
                box-shadow: 9984px 0 0 -5px;
                }
            }
            @keyframes dot-pulse {
                0% {
                box-shadow: 9999px 0 0 -5px;
                }
                30% {
                box-shadow: 9999px 0 0 2px;
                }
                60%, 100% {
                box-shadow: 9999px 0 0 -5px;
                }
            }
            @keyframes dot-pulse-after {
                0% {
                box-shadow: 10014px 0 0 -5px;
                }
                30% {
                box-shadow: 10014px 0 0 2px;
                }
                60%, 100% {
                box-shadow: 10014px 0 0 -5px;
                }
            }

            /* Minimize */
            .chatboxAi .chatbx_main.minimize .chatbx_car_details, .chatboxAi .chatbx_main.minimize .chatbx_window, .chatboxAi .chatbx_main.minimize .chatbx_input{
                display: none;
            }
            .chatboxAi .chatbx_main.minimize .chatbx_primary, .chatboxAi .chatbx_main.minimize .chatbx_secondary{
                height: auto;
            }
            .chatbx_main.minimize .full_screen, .chatboxAi .chatbx_main.minimize .chatboxO a, .chatboxAi .chatbx_disable{
                pointer-events: none;
                cursor: default;
            }
            .chatboxAi .chatbx_disable{
                color: var(--secondary) !important;
            }

            /* Close Msg */
            .chatboxAi .chatbx_close_conf{
                position: absolute;
                left: 0;
                right: 0;
                top: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                z-index: 1120;
            }
            .chatboxAi .chatbx_close_msg {
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                width: 260px;
                background-color: var(--white);
                border-radius: 8px;
                padding: 12px;
                text-align: center;
            }
            .chatboxAi .btn.btn_chatbx.chatbx_close_yes, .chatboxAi .btn.btn_chatbx.chatbx_close_no {
                font-size: 15px;
                padding: 4px 16px;
                border-radius: 7px;
            }

            .chatboxAi .chatbx_cars_slides.owl-carousel .owl-nav.disabled{
                display: block !important;
            }
            .chatboxAi .thumbnail_imgs .item{
                border-radius: 6px;
                overflow: hidden;
            }

            /* Full Details */
            .chatboxAi .chatbx_detail_full {
                position: relative;
            padding: 0 12px; 
            overflow-y: auto;
            overflow-x: hidden;
            }
            .chatboxAi .car_details_slider{
                margin-bottom: 12px;
            }
            .chatboxAi .chatbx_detail_full .main_slider{
                position: relative;
                border-radius: 8px;
                overflow: hidden;
                margin-bottom: 6px;
            }

            /* Fevorite Like */
            .chatboxAi .like_share_icon {
                position: absolute;
                top: 10px;
                left: 10px;
                right: 10px;
                z-index: 100;
                display: flex;
                align-items: center;
            }

            .chatboxAi .like_share_icon i {
                cursor: pointer !important;
            }

            .chatboxAi .like_share_icon .form-check.fevCheck {
                padding: 0;
                margin-bottom: 0;
                margin-right: 8px;
                display: flex;
                align-items: center;
            }

            .chatboxAi .like_share_icon .form-check.fevCheck label, .chatboxAi .like_share_icon .share_icon{
                width: 32px;
                height: 32px;
                color: var(--dark-light);
                background-color: var(--gray);
                border-radius: 50%;
                justify-content: center;
                display: flex;
                align-items: center;
                font-size: 14px;
                -webkit-transition: all 0.3s ease;
                -moz-transition: all 0.3s ease;
                transition: all 0.3s ease;
                cursor: pointer !important;
                border: 1px solid var(--border-color);
            }
            .chatboxAi .like_share_icon .form-check.fevCheck label:hover, .chatboxAi .like_share_icon .share_icon:hover {
                box-shadow: 0 .5rem 1rem rgba(0, 0, 0, .15) !important;
            }
            .chatboxAi .like_share_icon .form-check.fevCheck label:hover{
                color: var(--red);
            }
            .chatboxAi .like_share_icon .share_icon:hover{
                color: var(--primary);
            }
            /* .like_share_icon.details_like_share .form-check.fevCheck label, .like_share_icon.details_like_share .share_icon{
                width: 40px;
                height: 40px;
                color: var(--dark-light);
                background-color: var(--gray);
                border-radius: 50%;
                justify-content: center;
                display: flex;
                align-items: center;
                -webkit-transition: all 0.3s ease;
                -moz-transition: all 0.3s ease;
                transition: all 0.3s ease;
            } */

            .chatboxAi .like_share_icon .form-check.fevCheck .form-check-input {
                display: none;
            }

            .chatboxAi .like_share_icon .form-check.fevCheck .form-check-input:checked+.form-check-label #heart-icon {
                color: var(--red);
            }

            .chatboxAi .like_share_icon {
                color: var(--card-icons);
                font-size: 18px;
            }

            .chatboxAi .like_share_icon .form-check.fevCheck .fas {
                color: var(--red);
            }

            /* All photos */
            .chatboxAi .view_all_photos {
                position: absolute;
                bottom: 10px;
                right: 10px;
                z-index: 2;
            }

            .chatboxAi .view_all_photos .all_photos {
                background-color: var(--white);
                padding: 5px 7px;
                border-radius: 5px;
                color: var(--dark-light);
                font-size: 13px;
                cursor: pointer;
                -webkit-transition: all 0.3s ease;
                -moz-transition: all 0.3s ease;
                transition: all 0.3s ease;
            }

            .chatboxAi .view_all_photos .all_photos:hover {
                background-color: var(--primary);
                color: var(--white);
            }

            /* Car Title - details */
            .chatboxAi .btn_theme {
                color: var(--white);
                background-color: var(--primary);
                border-color: var(--primary);
            }

            .chatboxAi .btn_theme:hover,
            .chatboxAi .btn_theme:focus {
                background-color: var(--white);
                border-color: var(--primary);
                color: var(--primary);
            }

            .chatboxAi .car_details_right_top {
                background-color: var(--gray);
                border-radius: 16px;
                padding-bottom: 12px;
                border: 1px solid rgba(36, 39, 44, .1);
                box-shadow: 0px 6px 10px rgba(0, 0, 0, .05);
            }

            .chatboxAi .car_details_right_top .btm_gray p {
                margin-bottom: 0;
                color: var(--secondary);
                text-align: center;
                font-weight: 300;
            }

            .chatboxAi .car_details_right_inn {
                background-color: var(--white);
                border-radius: 16px;
                margin-bottom: 12px;
                padding: 12px;
            }

            .chatboxAi .car_details_spec {
                position: relative;
                font-size: 14px;
                display: flex;
                align-items: center;
                margin-bottom: 12px;
            }

            .chatboxAi .car_details_spec .car_year {
                color: var(--primary);
                background-color: var(--primary-light);
                border: 1px solid var(--primary);
                padding: 3px 6px;
                border-radius: 5px;
                margin-right: 12px;
            }

            .chatboxAi .car_details_spec .car_loc {
                color: var(--secondary);
                font-weight: 300;
            }

            .chatboxAi .car_title_price_specs h4 {
                font-size: 22px;
                font-weight: 300;
                margin-bottom: 6px;
            }

            .chatboxAi .car_title_price_specs .car_spec_short {
                font-size: 14px;
                font-weight: 300;
                color: var(--secondary);
                margin-bottom: 12px;
            }

            .chatboxAi .car_title_price_specs h5 {
                font-size: 28px;
                font-weight: 900;
                margin-bottom: 20px;
            }

            .chatboxAi .car_details_right_top .btn {
                font-size: 16px;
                font-weight: 300;
            }

            .chatboxAi .req_in_border {
                border: 0;
                border-bottom: 1px solid var(--secondary);
                background-color: rgba(239, 243, 250, 0.3);
            }

            .chatboxAi .req_in_border.req_in_wsm {
                width: 100px;
            }

            .chatboxAi .details_req_info p {
                margin-bottom: 0;
            }

            .chatboxAi .details_req_info span {
                line-height: 34px;
            }

            .chatboxAi .details_req_info form p label.error {
                display: none !important;
            }

            .chatboxAi .req_in_border.error {
                border-color: var(--red) !important;
            }

            /* Details info tabs */
            .chatboxAi .details_info_tabs {
                position: relative;
                margin: 0;
                padding: 12px 0;
                position: -webkit-sticky;
                position: sticky;
                z-index: 10;
                background-color: var(--white);
            }

            .chatboxAi .details_info_tabs a {
                position: relative;
                padding: 6px 10px;
                color: var(--dark-light);
                background-color: var(--gray);
                border-radius: 30px;
                font-size: 12px;
                text-transform: uppercase;
                display: inline-block;
                cursor: pointer !important;
            }

            .chatboxAi .details_info_tabs a:hover {
                color: var(--white);
                background-color: var(--dark-light);
            }

            .chatboxAi .details_tab_content {
                background: #fff;
                border: 1px solid rgba(36, 39, 44, .1);
                box-shadow: 0px 6px 10px rgba(0, 0, 0, .05);
                border-radius: 16px;
                padding: 12px;
                margin-bottom: 10px;
                display: inline-block;
                width: 100%;
            }
            .chatboxAi .tab_content_head h3 {
                font-weight: 700;
                font-size: 18px;
                line-height: 18px;
                color: var(--dark);
                margin-bottom: 12px;
            }
            .chatboxAi .specs_list ul,
            .chatboxAi .features_list ul {
                list-style: none;
                padding: 0;
                margin-bottom: 0;
            }

            .chatboxAi .specs_left p,
            .chatboxAi .specs_right p,
            .chatboxAi .feature_inn p {
                font-size: 14px;
                font-weight: 300;
                margin-bottom: 10px;
            }

            .chatboxAi .specs_left p {
                color: var(--secondary);
            }

            .chatboxAi .specs_right p {
                color: var(--dark-light);
                text-align: end;
            }

            .chatboxAi .feature_inn p i {
                color: var(--green);
            }

            .chatboxAi .details_tab_content hr {
                background-color: var(--secondary);
                margin-top: 6px;
            }

            /* Collapse */
            .chatboxAi .details_features .accordion-button {
                font-size: 18px;
                font-weight: 500;
                padding-left: 0;
                padding-right: 0;
            }

            .chatboxAi .details_features .accordion-item:first-child .accordion-button {
                padding-top: 0;
            }

            .chatboxAi .details_features .accordion-button:focus {
                border-color: transparent;
                box-shadow: none;
            }

            .chatboxAi .details_features .accordion-button:not(.collapsed) {
                color: var(--dark-light);
                background-color: var(--white);
                box-shadow: none;
            }

            .chatboxAi .details_features .accordion-body {
                padding: 12px 0;
            }

            .chatboxAi .details_features .accordion-button:not(.collapsed)::after {
                background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23FF4605'><path fill-rule='evenodd' d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/></svg>") !important;
            }

            /* Explore More */
            .chatboxAi .chatbx_explore_card.chatbx_car_card {
                background-color: var(--dark);
                border: 0;
            }
            .chatboxAi .chatbx_explore_card a{
                color: var(--white);
            }
            .chatboxAi .chatbx_explore_card.chatbx_car_card .car_spec {
                font-size: 14px;
                display: flex;
                align-items: center;
            }

            .chatboxAi .chatbx_explore_card.chatbx_car_card hr {
                margin-bottom: 10px;
                border-color: rgba(36, 39, 44, .1);
            }

            .chatboxAi .chatbx_explore_card .car_spec_year {
                color: var(--white);
                background-color: var(--primary);
                padding: 4px 6px;
                border-radius: 5px;
                margin-right: 12px;
            }

            .chatboxAi .chatbx_explore_card .car_spec_info {
                color: var(--secondary);
            }

            .chatboxAi .chatbx_explore_card .car_spec_info hr {
                margin: 10px 0;
            }

            .chatboxAi .chatbx_explore_card .like_share_icon{
                left: auto;
            }

            /* Explore Filter */

            .chatboxAi .filter_head_reset {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 16px;
                padding-bottom: 12px;
                border-bottom: 1px solid rgba(36, 39, 44, .1);
            }

            .chatboxAi .filter_head {
                font-weight: 600;
            }

            /* Reset Filter */
            .chatboxAi .reset_filter {
                position: relative;
                text-align: right;
            }

            .chatboxAi .reset_filter a {
                color: var(--primary);
            }

            /* Filter Btns */
            .chatboxAi .listing_filter_btns {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 16px;
            }

            /* .offcanvas_close,
            .listing_filter_icon {
                display: none;
            } */

            .chatboxAi .listing_filter_btns .btn-check+label {
                color: var(--dark-light);
                background-color: var(--gray);
                border: 1px solid var(--gray);
            }

            .chatboxAi .listing_filter_btns .btn-check:checked+label,
            .chatboxAi .listing_filter_btns .btn-check:focus+label {
                color: var(--primary);
                background-color: var(--primary-light);
                border: 1px solid var(--primary);
            }

            .chatboxAi .filterbox_bg {
                background: #fff;
                border: 1px solid rgba(36, 39, 44, .1);
                /* box-shadow: 0px 6px 10px rgba(0, 0, 0, .05); */
                border-radius: 12px;
                padding: 12px 0;
                display: inline-block;
                width: 100%;
                margin-bottom: 6px;
            }

            .chatboxAi .listing_filter_form label {
                margin-bottom: 6px;
                font-size: 12px;
            }

            .chatboxAi .collapse_head {
                color: var(--dark-light) !important;
                font-weight: 700;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .chatboxAi .form-check-input:checked {
                background-color: var(--primary);
                border-color: var(--primary);
            }

            .chatboxAi .listing_searchbx,
            .chatboxAi .checkbox_list,
            .chatboxAi .select_filter,
            .chatboxAi .collapse_head,
            .chatboxAi .zip_rad_filter {
                padding: 0 16px;
            }
            .chatboxAi .zip_rad_filter .btn{
                margin-top: 6px;
            }

            .chatboxAi .range_slider {
                padding: 0 16px;
            }

            .chatboxAi .checkbox_list,
            .chatboxAi .select_filter {
                margin-top: 16px;
                margin-bottom: 0;
                overflow-y: auto;
                max-height: 250px;
            }

            .chatboxAi .checkbox_list li {
                margin-bottom: 6px;
            }

            .chatboxAi .collapse_head .collapse_icon {
                color: var(--secondary);
            }

            .chatboxAi .collapse_head.collapsed .collapse_icon .fa-plus,
            .chatboxAi .collapse_head .collapse_icon .fa-minus {
                display: block;
            }

            .chatboxAi .collapse_head.collapsed .collapse_icon .fa-minus,
            .chatboxAi .collapse_head .collapse_icon .fa-plus {
                display: none;
            }

            .chatboxAi .checkbox_list .form-check-label {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .chatboxAi .checkbox_list .form-check-label .filter_count {
                color: var(--secondary);
            }

            .chatboxAi .filter_colorSq {
                display: inline-block;
                width: 15px;
                height: 15px;
                border-radius: 3px;
                margin-right: 6px;
            }

            .chatboxAi .filter_bodyimg {
                height: 18px;
                display: flex;
                align-items: center;
                margin-right: 6px;
            }

            .chatboxAi .filter_bodyimg img {
                width: 100%;
                height: 100%;
            }


            /* Range Slider */
            .chatboxAi .range_slider {
                position: relative;
                width: 100%;
                background-color: #ffffff;
                border-radius: 10px;
                margin: 16px 0 12px;
            }

            .chatboxAi .range_slider_bar {
                position: relative;
                min-height: 20px;
            }

            .chatboxAi .range_slider input[type="range"] {
                -webkit-appearance: none;
                -moz-appearance: none;
                appearance: none;
                width: 100%;
                outline: none;
                position: absolute;
                margin: auto;
                top: 0;
                bottom: 0;
                background-color: transparent;
                pointer-events: none;
            }

            .chatboxAi .range_slider .slider-track {
                width: 100%;
                height: 5px;
                position: absolute;
                margin: auto;
                top: 0;
                bottom: 0;
                border-radius: 5px;
            }

            .chatboxAi .range_slider input[type="range"]::-webkit-slider-runnable-track {
                -webkit-appearance: none;
                height: 5px;
            }

            .chatboxAi .range_slider input[type="range"]::-moz-range-track {
                -moz-appearance: none;
                height: 5px;
            }

            .chatboxAi .range_slider input[type="range"]::-ms-track {
                appearance: none;
                height: 5px;
            }

            .chatboxAi .range_slider input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                height: 20px;
                width: 20px;
                background-color: var(--primary);
                cursor: pointer;
                margin-top: -9px;
                pointer-events: auto;
                border-radius: 50%;
            }

            .chatboxAi .range_slider input[type="range"]::-moz-range-thumb {
                -webkit-appearance: none;
                height: 14px;
                width: 14px;
                cursor: pointer;
                border-radius: 50%;
                background-color: var(--primary);
                pointer-events: auto;
                border: none;
            }

            .chatboxAi .range_slider input[type="range"]::-ms-thumb {
                appearance: none;
                height: 14px;
                width: 14px;
                cursor: pointer;
                border-radius: 50%;
                background-color: var(--primary);
                pointer-events: auto;
            }

            .chatboxAi .range_slider input[type="range"]:active::-webkit-slider-thumb {
                background-color: #ffffff;
                border: 1px solid var(--primary);
            }

            .chatboxAi .range_slider .values {
                color: var(--primary);
                font-size: 14px;
                font-weight: 600;
                display: flex;
                align-items: center;
                margin-bottom: 20px;
            }

            .chatboxAi .range_slider .values span:last-child {
                margin-left: auto;
            }

            .chatboxAi .price-inputs {
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .chatboxAi .price-inputs input[type="text"] {
                width: 82px;
                margin: 0;
                padding: 5px 3px;
                text-align: center;
                border: 1px solid #ced4da;
                border-radius: 5px;
            }
            .chatboxAi .price-inputs span{
                margin: 0 2px;
            }
            .chatboxAi #priceRange, .chatboxAi #yearRange, .chatboxAi #mileageRange {
                margin-top: 20px;
            }

            .chatboxAi .range_slider .noUi-horizontal {
                height: 6px;
            }

            .chatboxAi .range_slider .noUi-horizontal .noUi-handle {
                width: 18px;
                height: 18px;
                top: -7px;
                border-radius: 20px;
                box-shadow: none;
                background: var(--primary);
                right: -10px;
            }

            .chatboxAi .range_slider .noUi-connect {
                background: var(--primary) !important;
            }

            .chatboxAi .range_slider .noUi-handle:after,
            .chatboxAi .noUi-handle:before {
                display: none !important;
            }
            /* Range Slider End */

            /* Bootstrap Offcanvas */
            /* .offcanvas-collapse {
                position: fixed;
                top: 0;
                bottom: 0;
                right: 100%;
                width: 42%;
                padding: 60px 30px 16px;
                overflow-y: auto;
                visibility: hidden;
                background-color: var(--white);
                transition: transform .3s ease-in-out, visibility .3s ease-in-out;
                z-index: 1030;
            }

            .offcanvas-collapse.open {
                visibility: visible;
                transform: translateX(100%);
            }

            .offcanvas_close {
        position: absolute;
        top: 8px;
        right: 10px;
        font-size: 15px;
        padding: 10px;
        border-radius: 50%;
        background-color: var(--white);
        z-index: 1100;
    } */

    .chatboxAi .listing_filter_close{
        margin-bottom: 10px;
        text-align: end;
    }
    .chatboxAi .chatbx_main.chat_open.fullScreen .listing_filter_close, .chatboxAi .chatbx_main.chat_open.fullScreen .listing_filter_icon{
        display: none;
    }
    .chatboxAi .offcanvas_close,
    .chatboxAi .listing_filter_icon {
        display: block;
    }

    .chatboxAi .listing_filter_icon .navbar-toggler {
        padding: 0;
        font-size: 16px;
        color: var(--dark-light);
        white-space: nowrap;
    }
    .chatboxAi .listing_sort .form-select{
        padding-top: 4px;
        padding-bottom: 4px;
    }

    /* @media (min-width: 992px){ */
    .chatboxAi .chatbx_main.chat_open.fullScreen .explore_filters_col{
            display: block;
        }
        .chatboxAi .chatbx_main.chat_open.fullScreen .explore_filters_col{
            position: relative;
        }
        .chatboxAi .chatbx_main.chat_open .listingFilterOpen .explore_filters_col{
            display: block;
        }
        .chatboxAi .chatbx_main.chat_open .explore_filters_col{
            position: absolute;
            top: 0;
            bottom: 0;
            left: 0;
            right: 0;
            z-index: 300;
            background-color: var(--white);
            overflow-y: auto;
            display: none;
        }
        .chatboxAi .chatbx_main.chat_open .listingFilterOpen{
            overflow: hidden !important;
        }
        .chatboxAi .chatbx_main.chat_open.fullScreen .listingFilterOpen{
            overflow-y: auto !important;
        }
    /* } */

    /* Auth Forms */
    .chatboxAi .auth_forms, .chatboxAi .userinfo_forms {
        display: flex;
        align-items: center;
        width: 300px;
        margin: 0px auto;
        padding: 16px 0;
        min-height: inherit;
    }
    .chatboxAi .auth_forms, .chatboxAi .auth_forms .form-control, .chatboxAi .auth_forms .auth_sociallinks .btn span, .chatboxAi .listing_sort .form-select {
        font-size: 15px;
    }
    .chatboxAi .auth_forms .auth_ortext{
        padding: 15px 0;
    }
    .chatboxAi .auth_forms .auth_ortext p small::before,
    .chatboxAi .auth_forms .auth_ortext p small::after {
        display: inline-block;
        content: "";
        border-top: 1px solid var(--secondary);
        width: 15%;
        margin: 0 15px;
        transform: translateY(-4px);
    }
    .chatboxAi .auth_forms .auth_ortext p small{
        color: var(--secondary);
    }
    .chatboxAi .auth_forms .auth_sociallinks .btn{
        border: 1px solid #ced4da;
    }
    .chatboxAi .auth_forms .auth_sociallinks .btn{
        display: flex;
        align-items: center;
    }
    .chatboxAi .auth_forms .auth_sociallinks .btn img{
        width: 24px;
    }
    .chatboxAi .auth_forms .auth_sociallinks .btn span{
        margin: 0 auto;
    }
    .chatboxAi .auth_forms .auth_sociallinks .btn:hover, .chatboxAi .auth_forms .auth_sociallinks .btn:focus{
        border-color: var(--dark);
    }


    /* RESPONSIVE */
    @media (max-width: 1024px){
        .chatboxAi .banner_chatbox_text {
            font-size: 18px;
        }

        /* Favorite Like */
        .chatboxAi .like_share_icon .form-check.fevCheck label, .chatboxAi .like_share_icon .share_icon{
            width: 32px;
            height: 32px;
            font-size: 14px;
        }
        .chatboxAi .like_share_icon.details_like_share .form-check.fevCheck label, .chatboxAi .like_share_icon.details_like_share .share_icon {
            width: 36px;
            height: 36px;
            font-size: 16px;
        }
    }
    @media (max-width: 991px){
        .chatboxAi .hisbar{
            display: block;
        }
        .chatboxAi .chatbx_main.chat_open.auth_true .chatbx_secondary{
            position: absolute;
            width: 100%;
            left: 0;
            right: 0;
            top: 0;
            bottom: 0;
        }
        .chatboxAi .history_show{
            position: relative;
            width: 250px !important;
            height: 100%;
            background-color: var(--gray);
            z-index: 10;
        }
        .chatboxAi .chatbx_main.collapsed .chatbx_secondary {
            width: 300px;
        }

        /* Favorite Like */
        .chatboxAi .like_share_icon .form-check.fevCheck label, .chatboxAi .like_share_icon .share_icon{
            width: 28px;
            height: 28px;
            font-size: 14px;
        }
        .chatboxAi .like_share_icon.details_like_share .form-check.fevCheck label, .chatboxAi .like_share_icon.details_like_share .share_icon {
            width: 32px;
            height: 32px;
            font-size: 14px;
        }

        /* All photos */
        .chatboxAi .view_all_photos .all_photos {
            padding: 5px 6px;
            border-radius: 5px;
            font-size: 13px;
        }

        /* Listing Filter */
        .chatboxAi .chatbx_main.chat_open.fullScreen .listing_filter_close, .chatboxAi .chatbx_main.chat_open.fullScreen .listing_filter_icon{
            display: block;
        }
        .chatboxAi .chatbx_main.chat_open.fullScreen .explore_filters_col{
            position: absolute;
            display: none;
        }
        .chatboxAi .chatbx_main.chat_open .listingFilterOpen .explore_filters_col {
            display: block;
        }
        .chatboxAi .chatbx_main.chat_open.fullScreen .listingFilterOpen {
            overflow-y: hidden !important;
        }
    }
    @media (max-width: 600px){
        .chatboxAi .chatboxO {
            bottom: 16px;
            right: 16px;
        }
        .chatboxAi .chatbx_main.collapsed .chatbx_secondary {
            width: 350px;
            position: absolute;
            left: 0;
            z-index: 100;
            border-radius: 16px;
        }
        .chatboxAi .chatbx_main.chat_open.fullScreen.collapsed .chatbx_secondary{
            width: 100%;
            border-radius: 0;
        }
        .chatboxAi .chatbx_main.fullScreen .chatbx_primary {
            width: 100%;
            max-width: 100%;
        }
        .chatboxAi .chatbx_main.fullScreen .chatbx_car_card_main, .chatboxAi .chatbx_car_card_main{
            width: 270px;
            max-width: 270px;
        }
    }
        .loader-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.5); /* Semi-transparent background */
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 9999; /* Ensure it's on top of everything else */
                }

                .loader {
                    border: 16px solid #f3f3f3;
                    border-radius: 50%;
                    border-top: 16px solid #3498db;
                    width: 120px;
                    height: 120px;
                    animation: spin 2s linear infinite;
                }

                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `);

            // Load and initialize external scripts (e.g., Owl Carousel)
            loadScript('https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/owl.carousel.min.js', function() {
                // JavaScript for toggling the chatbox
                // document.querySelector('.chatboxO_a').addEventListener('click', function() {
                //     const chatboxMain = document.querySelector('.chatbx_main');
                //     chatboxMain.style.display = chatboxMain.style.display === 'block' ? 'none' : 'block';
                // });

                // Script added by amol
                $(document).on('click', '.chatbx_cars_slides .owl-next', function() {
                    if ($('.chatbx_main').hasClass('collapsed')) {
                        $('.chatbx_main').removeClass('collapsed');
                        $('.chatbx_fulldetail_info').removeClass('chatbxdetails_show');
                    }
                });
            
                $(document).on('click', '.chatbx_cars_slides .owl-prev', function() {
                    if ($('.chatbx_main').hasClass('collapsed')) {
                        $('.chatbx_main').removeClass('collapsed');
                        $('.chatbx_fulldetail_info').removeClass('chatbxdetails_show');
                    }
                });

                function initializeChatbot() {

                    if ($('.chatbx_main').hasClass('fullScreen') == false) {
                        var chatbxWindowHeight = $('.chatbx_primary').innerHeight() - ($('.chatbx_head').innerHeight() + $('.chatbx_input').innerHeight());
                        $('.chatbx_window').css({'min-height': chatbxWindowHeight, 'max-height': chatbxWindowHeight});
                        $('.explore_main').css({'min-height': chatbxWindowHeight, 'max-height': chatbxWindowHeight, 'top': $('.chatbx_head').innerHeight()});

                        $('.chatbx_primary').innerWidth('350px');
                        $('body').css('overflow', 'unset');
                        $('.chatbx_card_col').removeClass('col-lg-4 col-md-6');
                        $('.explore_filters_col').removeClass('col-lg-3');
                        $('.explore_list_col').removeClass('col-lg-9');
                        chatbxFulldetails();
            
                    } else {

                        var chatbxWindowHeight = $(window).height() - ($('.chatbx_primary .chatbx_head').innerHeight() + $('.chatbx_primary .chatbx_input').innerHeight());
                        $('.chatbx_window').css({'min-height': chatbxWindowHeight, 'max-height': chatbxWindowHeight});
                        $('.explore_main').css({'min-height': chatbxWindowHeight, 'max-height': chatbxWindowHeight, 'top': $('.chatbx_head').innerHeight()});
                        $('.chatbx_window').css('overflow-y', 'auto');
                        $('body').css('overflow', 'hidden');
            
                        if($(window).width() < 991 && $(window).width() > 600){
                            var primaryWidth = $('.chatbx_main').innerWidth() / 1.6;
                        } else if($(window).width() < 600){
                            var primaryWidth = $('.chatbx_main').innerWidth();
                        } else{
                            var primaryWidth = $('.chatbx_main').innerWidth() / 2;
                        }
                        $('.chatbx_primary').innerWidth(primaryWidth);
                        $('.chatbx_card_col').addClass('col-lg-4 col-md-6');
                        $('.explore_filters_col').addClass('col-lg-3');
                        $('.explore_list_col').addClass('col-lg-9');
                        chatbxFulldetails();
            
                    }
            
                    
                }
                window.initializeChatbot = initializeChatbot;

                function resetchatbx() {
                    $('body').css('overflow', 'unset');
                    $('.chatbx_main').removeClass('collapsed');
                    $('.chatbx_main').removeClass('fullScreen');
                    $('.chatbx_req_info').removeClass('chatbxreq_show');
                    $('.chatbx_fulldetail_info').removeClass('chatbxdetails_show');
                }

                // Call the function to initialize chatbot on page load
               
                    initializeChatbot();

                    $('.chatboxO_a').click(function(e) {
                    
                        if($('.chatbx_main').hasClass('chat_open')){
                            $('.chatbx_window').css('overflow-y', 'hidden');
                            $('.chatbx_main').removeClass('collapsed');
                            $('.chatbx_close_conf').css('display', 'block'); 
                        } else {
                            $('.chatbx_main').addClass('chat_open');
                        }
                        
                    });
                    $('.chatbx_close_yes').click(function(e) {
                        $('.chatbx_close_conf').css('display', 'none');        
                        $('.chatbx_window').css('overflow-y', 'auto');
                        $('.chatbx_main').removeClass('chat_open');
                        $('.chatbx_response').html(` <div class="chatbx_msg_l"><small class="welcome_message">Hello, my name is Autopulse, your AI automotive concierge.</small></div>`);
                        conversation_id = '';
                        context = '';
                        lastUserInput = '';
                        lastFormData = {};
                        resetchatbx();
                        initializeChatbot();
                    });
                    $('.chatbx_close_no').click(function(e) {
                        $('.chatbx_close_conf').css('display', 'none');        
                        $('.chatbx_window').css('overflow-y', 'auto');
                    });

                    // collapse sections

                    $('.chatbxreq_show_btn').click(function(e) {
                        $('.chatbx_req_info').toggleClass('chatbxreq_show');
                    });

                    $('.full_screen').click(function(e) {
                        e.preventDefault();
                        $('.chatbx_main').toggleClass('fullScreen');
                        chatbxListingCars();
                        chatbxListingFilter();
                        initializeChatbot();
                    });

                    // Minimize
                    $('.mini_a').click(function(e) {
                        e.preventDefault();
                        if($('.chatbx_main').hasClass('chat_open')){       
                            $('.chatbx_main').removeClass('chat_open');
                        } else {
                            $('.chatbx_main').addClass('chat_open');
                        }
                        // if($('.chatbx_main').hasClass('fullScreen')){
                        //     $('.chatbx_main').removeClass('fullScreen');
                        //     initializeChatbot();
                        // }    
                        // $('.chatbx_main').toggleClass('minimize');    
                    });
                
                // 

                // Listing filter collapse
               

               
                // Script added by amol end

                

                // Load chatbot settings and initialize the widget
                if (userId) {
                    // Fetch chatbot settings
                    fetch('http://127.0.0.1:8000/api/chatbot-settings/' + userId)
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                document.getElementById('chatbot-name').innerText = data.data.chatbot_name || 'Ask a question';
                                document.getElementById('chatbot-logo').src = data.data.logo || '/assets/images/chatbxSearch.png';
                                document.getElementById('chatbot-auto-logo').src = data.data.icon_logo || '/assets/images/chatbxSearch.png';
                                var elements = document.querySelectorAll('.welcome_message');

                                // Loop through all selected elements
                                elements.forEach(function(element) {
                                    element.innerHTML = 'Hello, my name is <b>' + data.data.chatbot_name + '</b>, your AI automotive concierge.' || 'Ask a question';
                                });
                               // document.getElementById('welcome_message').innerText = 'Hello, my name is <b>'+data.data.chatbot_name+'</b> , your AI automotive concierge.' || 'Ask a question';
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

                // Send message on button click
                document.getElementById('sendBtn').addEventListener('click', function() {
                    sendUserMessage();
                });

                // Send message on Enter key
                document.getElementById('userInput').addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        sendUserMessage();
                    }
                });

                // Function to send the user's message
                function sendUserMessage() {
                    const userInput = document.getElementById('userInput').value.trim();
                    lastUserInput = userInput; // Store the last user input

                    if (userInput === '') return;
                    if (userInput.length > 2000) {
                        alert('Query should not be more than 2000 characters.');
                        return;
                    }

                    // Display user message in chatbox
                    document.querySelector('.chatbx_response').innerHTML += `<div class="chatbx_msg_r"><small>${userInput}</small><span class="ch_time">${getCurrentTime()}</span></div>`;
                    document.getElementById('userInput').value = '';
                    document.getElementById('charCount').textContent = '0/2000';

                    // Show the loader
                    document.getElementById('loader').style.display = 'block';
                    document.getElementById('sendBtn').classList.add('chatbx_disable');

                    // Prepare the data to be sent
                    const formData = {
                        request: userInput,
                        context: context || '',
                        conversation_id: conversation_id || '',
                        dealerId :userId
                    };

                    // Define the API URL (replace with your actual route)
                    const url = 'http://127.0.0.1:8000/api/chat';  // Example API endpoint

                    // Perform the AJAX request
                    fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(formData)
                    })
                    .then(response => response.json())
                    .then(data => {
                        // Hide the loader
                        document.getElementById('loader').style.display = 'none';
                        document.getElementById('sendBtn').classList.remove('chatbx_disable');

                        if (data) {
                            conversation_id = data.conversation_id;
                            if (data.rawoutput !== 'Thank you for the question. This topic is beyond my training with providing support for automotive shoppers. I suggest using different resources. Are you interested in purchasing a new or pre-owned vehicle?') {
                                context += data.rawoutput;
                            }

                            // Parse and display the response in the chatbox
                            const responseText = formatApiResponse(data);
                            let html = data.html || '';

                            document.querySelector('.chatbx_response').innerHTML += `<div class="chatbx_msg_l"><small>${responseText}</small><span class="ch_time">${getCurrentTime()}</span></div>`;

                            if (html) {
                                let carhtml = `
                                    <div class="chatbx_car_card_main">
                                        <div class="owl-carousel owl-theme chatbx_cars_slides circular_nav">${html}</div>
                                        <span class="ch_time">${getCurrentTime()}</span>
                                    </div>`;
                                document.querySelector('.chatbx_response').innerHTML += carhtml;
                                
                                initializeCarousel();
                                document.querySelectorAll('.btn_expand').forEach(button => {
                                    button.addEventListener('click', function() {
                                        handleExpandButtonClick(button);
                                    });
                                });
                                document.querySelectorAll('.btn_exploere_more').forEach(button => {
                                    button.addEventListener('click', function() {
                                        handleapicall(button);
                                    });
                                });
                            }

                            // Scroll to the bottom
                            document.querySelector('.chatbx_window').scrollTop = document.querySelector('.chatbx_window').scrollHeight;
                        } else {
                            displayErrorMessage('Failed to fetch data from the API');
                        }
                    })
                    .catch(error => {
                        console.error('Error:', error);
                        displayErrorMessage('Error fetching chatbot response');
                    });
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
                    // Display the error message along with the resend button
                    document.querySelector('.chatbx_response').innerHTML += `
                        <div class="chatbx_msg_l">
                            <small>${message}</small><span class="ch_time">${getCurrentTime()}</span>
                            <a id="resendBtn" class="px-2"><i class="fa-solid fa-redo"></i> Resend</a>
                        </div>`;
                    document.querySelector('.chatbx_response').scrollTop = document.querySelector('.chatbx_response').scrollHeight;

                    // Attach event listener to the Resend button
                    document.getElementById('resendBtn').addEventListener('click', function() {
                        resendLastMessage();
                    });
                }

                function resendLastMessage() {
                    if (lastUserInput !== '') {
                        document.getElementById('userInput').value = lastUserInput;
                        sendUserMessage();
                    }
                }

                function getCurrentTime() {
                    const now = new Date();
                    return `${now.getHours()}:${(now.getMinutes() < 10 ? '0' : '') + now.getMinutes()}`;
                }

                
                

            });
        }

        function loadScript(url, callback) {
            const script = document.createElement('script');
            script.src = url;
            script.onload = callback;
            document.head.appendChild(script);
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
       
    });

    function chatbxListingFilter() {
        if ($('.chatbx_main').hasClass('fullScreen') == false && $('.chatbx_window').hasClass('listingFilterOpen') == true ) {
            setTimeout(function() {
                let chatbxListingFilterHeight = $('.chatbx_window').innerHeight();
                $('.explore_filters_col').css({'height': chatbxListingFilterHeight});
            }, 400);
        } else if($(window).width() > 992){
            $('.explore_filters_col').css({'height': 'auto'});
        } else if($(window).width() < 992){
            setTimeout(function() {
                let chatbxListingFilterHeight = $('.chatbx_window').innerHeight();
                $('.explore_filters_col').css({'height': chatbxListingFilterHeight});
            }, 400);
        }
    }
    function handleapicall(button){
        apiurl  = ($(button).attr('data_href'));
       
        apiresult(apiurl);
    }

    document.addEventListener('click', function(event) {
        if (event.target.closest("input[type='checkbox']") || event.target.closest("select")) {
            //loaderOverlay.style.display = "block";
            if (event.target.id != 'sorting') {
                validateAndSubmitForm();
            }
        }
    });

    document.addEventListener('change', function(event) {
        
        if (event.target.id === 'sorting') {
            let previousSortingValue = document.getElementById('sorting').value;
        
            const currentSortingValue = event.target.value;
            // Check if the value has actually changed
            console.log(previousSortingValue,'currentSortingValue',currentSortingValue);
            if (currentSortingValue !== previousSortingValue) {
                // Update the previous value to the new value
                previousSortingValue = currentSortingValue;
                
                // Call the functions since the value has changed
               
                validateAndSubmitForm();
            }
        }
    });

    document.addEventListener('click', function(event) {
        if (event.target.matches('.pagination a')) {
            event.preventDefault();
            var url = event.target.href;
            apiresult(url);
        }
        if (event.target.matches('.listing_filter_collapse')) {
            var chatbxWindow = document.querySelector('.explore_main');
            if (chatbxWindow) {
                // Toggle the class
                chatbxWindow.classList.toggle('listingFilterOpen');
            }            
            chatbxListingFilter();           
        }
        if (event.target.matches('.listing_cars_back')) {
            var chatbxWindow = document.querySelector('.explore_main');
            if (chatbxWindow) {
                chatbxWindow.classList.remove('listingCarsOpen');
            }                    
        }
    });

    // Function to handle API call
    function apiresult(url){
        const loaderOverlay = document.getElementById('widget_loader-overlay');
        loaderOverlay.style.display = "flex";
        fetch(url, {
            method: 'GET',
        })
        .then(response => response.json())
        .then(data => {
            if (data.html) {
                // Replace content with new HTML
                document.getElementById('explore_main').innerHTML = data.html;
                // Reinitialize any components or bindings
                initializeDynamicComponents();
                document.querySelectorAll('.btn_expand').forEach(button => {
                    button.addEventListener('click', function() {
                        handleExpandButtonClick(button);
                    });
                });
                let chatbxWindow = document.querySelector('.explore_main');
                if (chatbxWindow) {
                    chatbxWindow.classList.add('listingCarsOpen');
                    setTimeout(function() {
                        initializeChatbot();
                    }, 400);
                }
            }
        })
        .catch(error => console.error('Error:', error))
        .finally(() => {
            loaderOverlay.style.display = "none";
        });
    }

    // Initialize dynamic components like range sliders, tag removal, etc.
    function initializeDynamicComponents() {
        // Initialize range sliders
        //setupRangeSlider('priceRange', 'minPrice', 'maxPrice', [min, max], 'price_range', makepricerange);
        //setupRangeSlider('yearRange', 'minYear', 'maxYear', [min_year, max_year], 'year_range', makeyearrange);
        //setupRangeSlider('mileageRange', 'minMileage', 'maxMileage', [miles_start, miles_end], 'miles_range', makemileagerange);

        // Initialize tag removal
        window.makepricerange = function() {
            let minPrice = document.getElementById('minPrice').value.replace(/\$/g, '').replace(/,/g, '');
            let maxPrice = document.getElementById('maxPrice').value.replace(/\$/g, '').replace(/,/g, '');
            let priceRange = `${minPrice} - ${maxPrice}`;
    
            document.getElementById('price_range').value = priceRange;
    
            //loaderOverlay.style.display = "block";
    
            submitForm();
        };
        window.makeyearrange = function() {
            let minPrice = document.getElementById('minPrice').value.replace(/\$/g, '').replace(/,/g, '');
            let maxPrice = document.getElementById('maxPrice').value.replace(/\$/g, '').replace(/,/g, '');
            let priceRange = `${minPrice} - ${maxPrice}`;
    
            document.getElementById('price_range').value = priceRange;
    
            //loaderOverlay.style.display = "block";
    
            submitForm();
        };
        window.makemileagerange = function() {
            let minPrice = document.getElementById('minPrice').value.replace(/\$/g, '').replace(/,/g, '');
            let maxPrice = document.getElementById('maxPrice').value.replace(/\$/g, '').replace(/,/g, '');
            let priceRange = `${minPrice} - ${maxPrice}`;
    
            document.getElementById('price_range').value = priceRange;
    
            //loaderOverlay.style.display = "block";
    
            submitForm();
        };

        window.getlatlong = function() {
            if($('#zip').val() && $('#radius').val() ){
                var zipCode = $('#zip').val();
                var apiKey = "AIzaSyBaVOhSLQc7xrVpxgbuh-jJbxRLbJFqDiA";
                var geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json?address=" + zipCode + "&key=" + apiKey;
        
                $.ajax({
                    url: geocodeUrl,
                    type: 'GET',
                    success: function(response) {
                        if (response.status === 'OK' && response.results.length > 0) {
                            var lat = response.results[0].geometry.location.lat;
                            var lng = response.results[0].geometry.location.lng;
                            document.getElementById('latitude').value = lat;
                            document.getElementById('longitude').value = lng;
                            document.getElementById('country').value = 'US';
                            submitForm(); // Proceed to submit the form
                        } else {
                            alert('Invalid ZIP code. Please enter a valid ZIP code.');
                        }
                    },
                    error: function(xhr, status, error) {
                        alert('An error occurred while validating the ZIP code. Please try again.');
                    }
                });
            }
        }
        document.querySelectorAll('.tag-remove').forEach(function(link) {
            link.addEventListener('click', function() {
                const key = this.getAttribute('data-key');
                const value = this.getAttribute('data-value');
                const form = document.createElement('form');
                form.method = 'GET';
                form.action = 'http://127.0.0.1/api/vehicle';
                const urlParams = new URLSearchParams(window.location.search);
                urlParams.delete(key);

                urlParams.forEach((v, k) => {
                    if (k === key && Array.isArray(urlParams.getAll(k))) {
                        urlParams.getAll(k).forEach(val => {
                            if (val !== value) {
                                const input = document.createElement('input');
                                input.type = 'hidden';
                                input.name = k + '[]';
                                input.value = val;
                                form.appendChild(input);
                            }
                        });
                    } else if (v !== value) {
                        const input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = k;
                        input.value = v;
                        form.appendChild(input);
                    }
                });

                document.body.appendChild(form);
                //loaderOverlay.style.display = "block";
                form.submit();
            });
        });
    }

    // Function to initialize a range slider
    function setupRangeSlider(sliderId, minInputId, maxInputId, startValues, rangeInputName, callback) {
        var slider = document.getElementById(sliderId);
        noUiSlider.create(slider, {
            start: startValues,
            connect: true,
            range: {
                'min': 0,
                'max': 10000000
            },
            format: {
                to: function(value) {
                    return '' + Math.round(value).toLocaleString();
                },
                from: function(value) {
                    return Number(value.replace('', '').replace(',', ''));
                }
            }
        });

        var minInput = document.getElementById(minInputId);
        var maxInput = document.getElementById(maxInputId);

        slider.noUiSlider.on('update', function(values, handle) {
            if (handle === 0) {
                minInput.value = values[handle];
            } else {
                maxInput.value = values[handle];
            }
        });

        minInput.addEventListener('change', function() {
            slider.noUiSlider.set([this.value.replace('', '').replace(',', ''), null]);
            callback();
        });

        maxInput.addEventListener('change', function() {
            slider.noUiSlider.set([null, this.value.replace('', '').replace(',', '')]);
            callback();
        });

        slider.noUiSlider.on('set', function() {
            callback();
        });
    }

    // Update sorting fields based on dropdown selection
    function updateSortFields() {
        const sortingDropdown = document.getElementById('sorting');
        const selectedValue = sortingDropdown.value;
        let [sort_by, sort_order] = selectedValue.split('-');
        document.getElementById('sort_by').value = sort_by || '';
        document.getElementById('sort_order').value = sort_order || '';
    }

    // Validate ZIP code and get latitude and longitude before submitting the form
    function validateAndSubmitForm() {
        /*var zipCode = document.getElementById("zip").value;
        if (zipCode === '') {
            alert('Please enter a valid ZIP code.');
            return;
        }*/

        //getLatLong(zipCode, function() {
            submitForm();
        //});
    }

    // Make price range string and submit form
    

    function submitForm() {
        var form = document.getElementById("searchinput");
    
        if (form) {
            var formData = new FormData(form);
            var params = new URLSearchParams(formData).toString();
            var apiurl ='http://127.0.0.1:8000/api/vehicle?' + params;
    
            // Make the API call
            apiresult(apiurl);
        } else {
            console.error('Form element with id "searchinput" not found.');
        }
    }

    
    
    function handleCloseButtonClick() {
        $('.chatbx_main').removeClass('collapsed');
        $('.chatbx_fulldetail_info').removeClass('chatbxdetails_show');
    }
    
    function handleExpandButtonClick(button) { 
    
        // Parse vehicle data from the button's data attribute
        const vehicle = JSON.parse(button.getAttribute('data_attr'));
        console.log(vehicle);
    
        // Container for vehicle details
        const container = document.getElementById('chatbx_car_details');
    
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
                                <!-- Favorite and share -->
                                <div class="like_share_icon details_like_share">
                                    <div class="form-check fevCheck">
                                        <input type="checkbox" class="form-check-input" id="btn-check_${vehicle['vin']}" onclick="makeFavourite(this,'${vehicle['id']}','${vehicle['vin']}','makeFavouiteRoute')">
                                        <label class="form-check-label" for="btn-check_${vehicle['vin']}"><i class="far fa-heart" id="heart-icon_${vehicle['vin']}"></i></label>
                                    </div>
                                    <div class="share_icon">
                                        <i class="fa-regular fa-share-from-square" onclick="showSharePopup('${vehicle['id']}', '${vehicle['vdp_url']}', '${title}')"></i>
                                    </div>
                                </div>
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
                                            <a href="sms:+${vehicle['dealer']['call_track_sms']}&&body=${encodeURIComponent(location.href)}" id="share-sms" class="d-md-none btn btn_blue ms-auto">
                                                <i class="fa-solid fa-comment me-1"></i><span>Text Message</span>
                                            </a>` : ''}
                                        </div>
                                    </div>
                                    <a href="javascript:;" class="btn btn_theme w-100" onclick="triggerViewdetail(this, '${vehicle['vin']}')">Request Contact from Dealer</a>
                                </div>
                                <div class="btm_gray">
                                </div>
                            </div>
    
                            <!-- Tabs -->
                            <div class="details_info_tabs" id="details_info_tabs">
                                <a class="overviewtab">Overview</a>
                                <a class="specificationstab">Specifications</a>
                                <a class="featurestab">Features</a>
                                <a href="${vehicle['vdp_url'] ?? ''}" target="_blank" class="view_dealerWeb">View Dealer Website</a>
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
                                                <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                    <p>VIN</p>
                                                </div>
                                                <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                    <p>${vehicle['vin'] ?? 'NA'}</p>
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
                                    ${Object.entries(vehicle['organized_features'] ?? {}).map(([key, value], i) => `
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
        </div>
        `;
    
        // Inject the generated HTML into the container
        container.innerHTML = vehicleDetailsHtml;
    
        // Optionally, initialize any carousels or UI components here
        initializeOwlCarousel();
        chatbxFulldetails();
        setTimeout(function() {
            document.querySelector('.chatbx_fulldetail_info').classList.add('chatbxdetails_show');
            chatbxSidebarCollapsed();
        }, 400);
        document.querySelectorAll('.chatbxfulldetail_show_btn').forEach(button => {
            button.addEventListener('click', function() {
                
                handleCloseButtonClick();
            });
        });
    }    
        
    function numberWithCommas(x) {
        if (x === null || x === undefined) {
            return 'N/A';
        }
        return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    // Collapse Sidebar
    function chatbxSidebarCollapsed() {
        if($('.chatbx_main').hasClass('collapsed') == false && $('.chatbx_fulldetail_info').hasClass('chatbxdetails_show')){
            $('.chatbx_main').addClass('collapsed');
        } else {
            $('.chatbx_main').removeClass('collapsed');
            $('.chatbx_main').addClass('collapsed');
        }
    }

    
    
    

    function chatbxListingCars() {
        var chatbxMain = document.querySelector('.chatbx_main');
        var exploreMain = document.querySelector('.explore_main');
        var exploreListCol = document.querySelector('.explore_list_col');
        
        if (exploreListCol) {
            if (!chatbxMain.classList.contains('fullScreen') && exploreMain.classList.contains('listingCarsOpen')) {
                setTimeout(function() {
                    var chatbxListingCarsHeight = exploreMain.clientHeight;
                    exploreListCol.style.height = chatbxListingCarsHeight + 'px';
                }, 400);
            } else if (window.innerWidth > 992) {
                exploreListCol.style.height = 'auto';
            } else if (window.innerWidth < 992) {
                setTimeout(function() {
                    var chatbxListingCarsHeight = exploreMain.clientHeight;
                    exploreListCol.style.height = chatbxListingCarsHeight + 'px';
                }, 400);
            }
        }        
    }

    function chatbxFulldetails() {
        let chatbxfulldetailsHeight = $('.chatbx_fulldetail_info').innerHeight() - $('.chatbx_fulldetail_info .chatbx_subhead').innerHeight();
        $('.chatbx_detail_full').css({'min-height': chatbxfulldetailsHeight, 'max-height': chatbxfulldetailsHeight});
    }

    // Function to get latitude and longitude from ZIP code
    function getLatLong(zipCode, callback) {
        var apiKey = "AIzaSyBaVOhSLQc7xrVpxgbuh-jJbxRLbJFqDiA";
        var geocodeUrl = "https://maps.googleapis.com/maps/api/geocode/json?address=" + zipCode + "&key=" + apiKey;

        $.ajax({
            url: geocodeUrl,
            type: 'GET',
            success: function(response) {
                if (response.status === 'OK' && response.results.length > 0) {
                    var lat = response.results[0].geometry.location.lat;
                    var lng = response.results[0].geometry.location.lng;
                    document.getElementById('latitude').value = lat;
                    document.getElementById('longitude').value = lng;
                    document.getElementById('country').value = 'US';
                    callback(); // Proceed to submit the form
                } else {
                    alert('Invalid ZIP code. Please enter a valid ZIP code.');
                }
            },
            error: function(xhr, status, error) {
                alert('An error occurred while validating the ZIP code. Please try again.');
            }
        });
    }

    function initializeCarousel() {
        // Initialize carousel after appending HTML content
        console.log(($(window).width()));
        if ($('.chatbx_main').hasClass('fullScreen') && $(window).width() > 1500) {
            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
            $('.chatbx_cars_slides').owlCarousel({
                items: 4,
                loop: true,
                margin: 10,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });
        } else if ($('.chatbx_main').hasClass('fullScreen') && $(window).width() > 991) {
            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
            $('.chatbx_cars_slides').owlCarousel({
                items: 3,
                loop: true,
                margin: 10,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });
        } else if ($('.chatbx_main').hasClass('fullScreen') && $(window).width() > 600) {
            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
            $('.chatbx_cars_slides').owlCarousel({
                items: 2,
                loop: true,
                margin: 10,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });                            
        } else {
            console.log('teim2');
            $('.chatbx_cars_slides').trigger('destroy.owl.carousel');
            $('.chatbx_cars_slides').owlCarousel({
                items: 1,
                loop: true,
                margin: 10,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
            });                            
        }  
       /* const carousels = document.querySelectorAll('.chatbx_cars_slides');
        carousels.forEach(carousel => {
            $(carousel).owlCarousel({
                items: 1,
                loop: true,
                margin: 10,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>", "<i class='fa-solid fa-angle-right'></i>"]
            });
        });*/
    }
  
    function initializeOwlCarousel() {
            var bigimage = $("#big");
            var thumbs = $("#thumbs");
    
            bigimage.owlCarousel({
                items: 1,
                slideSpeed: 2000,
                nav: false,
                autoplay: false,
                dots: false,
                loop: true,
                responsiveRefreshRate: 200
            }).on("changed.owl.carousel", debounce(syncPosition, 200));
    
            thumbs.owlCarousel({
                items: 5,
                dots: false,
                nav: true,
                navText: ["<i class='fa-solid fa-angle-left'></i>", "<i class='fa-solid fa-angle-right'></i>"],
                smartSpeed: 200,
                slideSpeed: 500,
                slideBy: 4,
                margin: 10,
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
    
            thumbs.on("click", ".owl-item", function(e) {
                e.preventDefault();
                var number = $(this).index();
                bigimage.data("owl.carousel").to(number, 300, true);
            });
    }
    
    function syncPosition(el) {
        var count = el.item.count - 1;
        var current = Math.round(el.item.index - el.item.count / 2 - 0.5);

        if (current < 0) {
            current = count;
        }
        if (current > count) {
            current = 0;
        }

        $("#thumbs").find(".owl-item").removeClass("current").eq(current).addClass("current");
        var onscreen = $("#thumbs").find(".owl-item.active").length - 1;
        var start = $("#thumbs").find(".owl-item.active").first().index();
        var end = $("#thumbs").find(".owl-item.active").last().index();

        if (current > end) {
            $("#thumbs").data("owl.carousel").to(current, 100, true);
        }
        if (current < start) {
            $("#thumbs").data("owl.carousel").to(current - onscreen, 100, true);
        }
    }
    var syncedSecondary = true;
    function syncPosition2(el) {
        if (syncedSecondary) {
            var number = el.item.index;
            $("#big").data("owl.carousel").to(number, 100, true);
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
    
    
    
})();

