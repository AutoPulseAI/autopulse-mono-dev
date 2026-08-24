!function(){var e=document.createElement("div");e.id="chatbot-widget",window.baseurl="https://chat.autopulse.ai/";let q=null,k="",L="",E=0,A=null,I=0,T=null,N=null,C=!(window.apiurl="https://chat.autopulse.ai/api/vehicle"),a=Date.now(),t=6e4,H=!1,l="Do you have any further query?",B=null,M=!1;const j=e.attachShadow({mode:"open"});function D(){var e=new Date;return e.getHours()+":"+(e.getMinutes()<10?"0":"")+e.getMinutes()}function s(){clearTimeout(N),a=Date.now(),H=!1,C&&(N=setTimeout(()=>{var e;!H&&L&&"none"!==j.querySelector(".chatbx_main").style.display&&(H=!0,e=D(),e=`<div class="chatbx_msg_l idle-message"><small>${l}</small><span class="ch_time">${e}</span></div>`,j.querySelector(".chatbx_response").innerHTML+=e,(e=j.querySelector(".chatbx_response"))&&(e.scrollTop=e.scrollHeight),e={conversion_id:L,action:"idle_message_sent",source:q,current_url:window.location.href,timestamp:(new Date).toISOString()},"function"==typeof triggerClickButton)&&triggerClickButton(e)},t))}function O(){C&&s()}function F(){if(B)try{var e={conversation_id:L,conversationCount:E,context:k,customerId:J(),booking_id:V(),booking:I,chatHistory:function(){var e=j.querySelector(".chatbx_response");if(!e)return[];const o=[],t=e.querySelectorAll(".chatbx_msg_l, .chatbx_msg_r");return t.forEach(e=>{var t=e.querySelector("small"),l=e.querySelector(".ch_time");t&&!t.classList.contains("welcome_message")&&o.push({content:t.innerHTML,type:e.classList.contains("chatbx_msg_r")?"user":"bot",time:l?l.textContent:"",classes:Array.from(e.classList),fullHtml:e.outerHTML})}),o}(),isFirstRequestMade:C,lastActivityTime:a,idleMessageSent:H,savedAt:Date.now(),savedOnUrl:window.location.href,savedOnTitle:document.title};localStorage.setItem(B,JSON.stringify(e))}catch(e){console.error("Failed to save chat state:",e)}}function P(t){if(t)try{if(R(),t.conversation_id&&(L=t.conversation_id,E=t.conversationCount||0,k=t.context||"",A=t.customerId||null,T=t.booking_id||null,I=t.booking||0),C=t.isFirstRequestMade||!1,a=t.lastActivityTime||Date.now(),H=t.idleMessageSent||!1,t.chatHistory&&0<t.chatHistory.length){var e=t.chatHistory;const o=j.querySelector(".chatbx_response");var l;o&&e.length&&((l=o.querySelector(".welcome_message"))?(l=l.closest(".chatbx_msg_l").outerHTML,o.innerHTML=l):o.innerHTML="",e.forEach(e=>{e.fullHtml&&!e.content.includes("welcome_message")&&(o.innerHTML+=e.fullHtml)}),o.scrollTop=o.scrollHeight)}setTimeout(()=>{var e;t.isChatOpen&&(e=j.querySelector(".chatbx_main"))&&(e.style.display="block"),t.isMinimized&&(e=j.querySelector(".chatbx_main"))&&e.classList.add("collapsed"),t.isFullScreen&&(e=j.querySelector(".chatbx_main"))&&e.classList.add("chat_open"),C&&s()},100)}catch(e){console.error("Failed to restore chat state:",e)}}function R(){L="",E=0,k="",A=null,T=null,I=0,C=!1,a=Date.now(),H=!1}function z(){var e=j.querySelector(".chatbx_response");if(e){var t=e.querySelectorAll(".welcome_message");if(1<t.length)for(let e=1;e<t.length;e++){var l=t[e].closest(".chatbx_msg_l");l&&l.remove()}}}document.body.appendChild(e);e=`
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
        `;function o(e,t){var l=document.createElement("script");l.src=e,l.onload=t,j.appendChild(l)}function u(){r()||(I=0,T=null,k="",L="",E=0,A=null,C=!1,a=Date.now(),H=!1,l="Do you have any further query?",t=6e4,N=null,M=!1,B=null),j.getElementById("chatbx_body").innerHTML=`
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
            `}function i(){j.getElementById("chatbx_body").innerHTML=`
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
            `;var e=document.createElement("style");e.textContent=`
                .chatbxbody_reg {
                    min-height: 500px;
                }
            `,j.appendChild(e);const n=j.getElementById("customerRegistrationForm"),l=(n.addEventListener("submit",async function(e){e.preventDefault(),j.querySelectorAll(".error-message").forEach(e=>{e.textContent="",e.classList.remove("show");e=e.previousElementSibling;e&&e.classList.remove("error")});var e=j.getElementById("regFirstName").value.trim(),t=j.getElementById("regLastName").value.trim(),l=j.getElementById("regEmail").value.trim(),o=j.getElementById("regPhone").value.trim();let a=!0;if(e||(d("firstNameError","First name is required"),a=!1),t||(d("lastNameError","Last name is required"),a=!1),l||o?(l&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l)&&(d("emailError","Please enter a valid email address"),a=!1),o&&!function(e){e=e.replace(/\D/g,"");return 10===e.length}(o)&&(d("phoneError","Please enter a valid 10-digit phone number"),a=!1)):(d("emailError",""),d("phoneError",""),j.getElementById("validation_msg").classList.add("error"),a=!1),a){var s=n.querySelector(".btn-submit");s.disabled=!0,s.textContent="Submitting...";try{var i=new FormData;i.append("first_name",e),i.append("last_name",t),i.append("email",l),i.append("phone_number",o),i.append("dealerId",q),i.append("current_url",window.location.href),i.append("page_title",document.title),i.append("referrer",document.referrer||"");var r=await(await fetch(window.baseurl+"api/vehicel/adfMail",{method:"POST",body:i})).json();if(!r.success||!r.data)throw new Error(r.message||"Registration failed");var c={customerId:A=r.data.id,firstName:e,lastName:t,email:l,phone:o,registrationDate:(new Date).toISOString(),vehicleInfo:{vin:r.data.vin,make:r.data.make,model:r.data.model,year:r.data.year}};localStorage.setItem("chatbotRegisteredCustomer",JSON.stringify(c)),isCustomerRegistered=!0,j.querySelector(".chatbx_body").classList.remove("chatbxbody_reg"),j.querySelector(".chatbx_body").classList.add("chatbxbody_chat"),u(),h()}catch(e){d("emailError","Registration failed. Please try again."),console.error("Registration error:",e)}finally{s.disabled=!1,s.textContent="Start Chatting"}}}),j.querySelector(".skip-btn").addEventListener("click",function(){Date.now(),(new Date).toISOString();isCustomerRegistered=!0,j.querySelector(".chatbx_body").classList.remove("chatbxbody_reg"),j.querySelector(".chatbx_body").classList.add("chatbxbody_chat"),u(),h()}),j.getElementById("regEmail")),o=j.getElementById("regPhone");function t(){var e=l.value.trim(),t=o.value.trim();(e||t)&&(a("emailError"),a("phoneError"))}function d(e,t){e=j.getElementById(e);e&&(e.textContent=t,e.classList.add("show"),t=e.previousElementSibling)&&t.classList.add("error")}function a(e){var e=j.getElementById(e);e&&(e.textContent="",e.classList.remove("show"),(e=e.previousElementSibling)&&e.classList.remove("error"),j.getElementById("validation_msg").classList.remove("error"))}l.addEventListener("input",t),o.addEventListener("input",t)}function J(){var e=localStorage.getItem("chatbotRegisteredCustomer");return e&&JSON.parse(e).customerId||null}function V(){if(B)try{var e=localStorage.getItem(B);if(e)return JSON.parse(e).booking_id||null}catch(e){console.error("Failed to get booking_id from storage:",e)}return null}function r(){var e=localStorage.getItem("chatbotRegisteredCustomer");return!!e&&(e=JSON.parse(e),A=e.customerId,isCustomerRegistered=!0)}function U(e){var t=e.querySelector(".chatbx_main"),l=e.querySelector(".chatbx_primary"),o=e.querySelector(".chatbx_head"),a=e.querySelector(".chatbx_input"),s=e.querySelector(".chatbx_window"),i=e.querySelector(".explore_main"),r=e.querySelectorAll(".chatbx_card_col"),c=e.querySelector(".explore_filters_col"),n=e.querySelector(".explore_list_col");if(t&&l&&o&&a&&s&&i){if(t.classList.contains("fullScreen")){var d=0===o.clientHeight?49:o.clientHeight,d=window.innerHeight-(d+a.clientHeight),d=(s.style.minHeight=d+"px",s.style.maxHeight=d+"px",window.innerHeight-o.clientHeight);i.style.minHeight=d+"px",i.style.maxHeight=d+"px",s.style.overflowY="auto",document.body.style.overflow="hidden";let e;e=window.innerWidth<991&&600<window.innerWidth?t.clientWidth/1.6:window.innerWidth<600?t.clientWidth:t.clientWidth/1.525,l.style.width=e+"px",r.length&&r.forEach(e=>{e.classList.add("col-xxxl-4","col-xl-6","col-lg-6")}),c&&c.classList.add("col-xxxl-3","col-xl-4","col-lg-4"),n&&n.classList.add("col-xxxl-9","col-xl-8","col-lg-8")}else{d=0===o.clientHeight?49:o.clientHeight,t=l.clientHeight-(d+a.clientHeight),d=(s.style.minHeight=t+"px",s.style.maxHeight=t+"px",l.clientHeight-o.clientHeight);i.style.minHeight=d+"px",i.style.maxHeight=d+"px",i.style.top=o.clientHeight+"px",l.style.width="350px",document.body.style.overflow="unset",r.length&&r.forEach(e=>{e.classList.remove("col-xxxl-4","col-xl-6","col-lg-6")}),c&&c.classList.remove("col-xxxl-3","col-xl-4","col-lg-4"),n&&n.classList.remove("col-xxxl-9","col-xl-8","col-lg-8")}W(e)}}function h(){var e=document.querySelectorAll('script[src*="shaddow.js"]');if(0<e.length&&(e=e[e.length-1].getAttribute("src"),e=new URLSearchParams(e.split("?")[1]),q=e.get("userid_id")),q){e=q,B="chatbot_state_"+e;const S=function(){if(!B||M)return null;try{var e,t=localStorage.getItem(B);return t?(e=JSON.parse(t),864e5<Date.now()-e.savedAt?(localStorage.removeItem(B),null):(M=!0,e)):null}catch(e){return console.error("Failed to load chat state:",e),null}}();window.location.href,document.title,navigator.userAgent,(new Date).toISOString(),q,S;q?fetch(baseurl+"api/chatbot-settings/"+q).then(e=>e.json()).then(t=>{if(t.success){var e=t.data.primary_color||"#000000",l=(j.querySelector("#chatbot-name").innerText=t.data.chatbot_name||"",j.querySelector("#chatbot-logo").src=t.data.icon_logo||"",j.querySelector("#chatbot-logo").style.display="block",j.querySelector("#chatbot-auto-logo").src=t.data.logo||"",t.data.icon_logo||"");j.querySelectorAll(".welcome_message").forEach(function(e){e.innerHTML=t.data.welcome_message||"Hello, my name is <b>"+t.data.chatbot_name+"</b>, your AI automotive concierge."}),"left"===(t.data.position||"right")&&j.querySelectorAll(".chatboxO, .chatbx_main").forEach(function(e){e.classList.remove("chatbox_ri")});const a=t.data.dealership_name||"AI";var o=j.querySelector(".chatboxAi .chatbx_response"),o=(o&&(o.querySelectorAll(".chatbx_msg_l").forEach(e=>{e.setAttribute("data-chatbot-name",a)}),new MutationObserver(e=>{e.forEach(e=>{e.addedNodes.forEach(e=>{1===e.nodeType&&e.classList.contains("chatbx_msg_l")&&e.setAttribute("data-chatbot-name",a)})})}).observe(o,{childList:!0,subtree:!0})),document.createElement("style")),l=(o.innerHTML=`
                                .chatboxAi .chatbx_response .chatbx_msg_l:before, 
                                .chatboxAi .chatbx_car_card_main:before, 
                                .chatboxAi .chatbx_msg_l.chatbx_msg_loader_inn:before {
                                    content: '';
                                    background: url('${l}');
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
                            `,j.appendChild(o),j.host.style.setProperty("--chbxprimary",e),e);4===(o=(o=l).replace(/^#/,"")).length&&(o=o.split("").map(function(e){return e+e}).join("")),e=parseInt(o.slice(0,2),16),l=parseInt(o.slice(2,4),16),o=parseInt(o.slice(4,6),16);e=`rgba(${e+`, ${l}, `+o}, 0.09)`;j.host.style.setProperty("--chbxprimary-light",e),j.host.style.setProperty("--dark","#222732"),j.host.style.setProperty("--dark-light","#2F3B48"),j.host.style.setProperty("--gray","#EFF3FA"),j.host.style.setProperty("--white","#ffffff"),j.host.style.setProperty("--secondary","#99A1B2"),setTimeout(()=>{S&&P(S),z()},500)}else console.error("Failed to load chatbot settings:",t.message),setTimeout(()=>{z()},500)}).catch(e=>{console.error("Error fetching chatbot settings:",e)}):console.error("User ID not found."),(e=document.createElement("div")).id="shadow-lightbox",e.style.display="none",e.innerHTML=`
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
            `,j.appendChild(e);let i=!1,t=(j.addEventListener("click",function(e){var t,l,o,a,s;e.target.closest(".chatboxO_a")?(i=!0,t=j.querySelector(".chatbx_main"),l=j.querySelector(".chatbx_body"),o=j.querySelector(".chatbx_window"),a=j.querySelector(".chatbx_close_conf"),s=j.querySelector(".chatbx_fulldetail_info"),t.classList.contains("chat_open")&&l.classList.contains("chatbxbody_reg")?t.classList.remove("chat_open"):t.classList.contains("chat_open")?(o&&(o.style.overflowY="hidden"),s&&s.classList.remove("chatbxdetails_show"),t&&t.classList.remove("collapsed"),a&&(a.style.display="block")):t.classList.add("chat_open")):e.target.closest(".chatboxO_a_main")&&(i=!0,j.querySelector(".chatbx_main").classList.add("chat_open"))}),setTimeout(()=>{var e=j.querySelector(".chatbx_main"),t=j.querySelector("#chatOpenSound");if(!i&&e&&!e.classList.contains("chat_open")&&(e.classList.add("chat_open"),t))try{t.currentTime=0,t.play().catch(e=>{console.warn("Autoplay blocked:",e)})}catch(e){console.warn("Audio play error:",e)}},15e3),!1);document.addEventListener("pointerdown",s),document.addEventListener("click",s),document.addEventListener("touchstart",s),document.addEventListener("keydown",s),j.addEventListener("click",function(e){var t,l;e.target.closest(".chatbx_close_yes")&&(e=j.querySelector(".chatbx_window"),t=j.querySelector(".chatbx_main"),l=j.querySelector(".chatbx_response"),j.querySelector(".chatbx_close_conf").style.display="none",e.style.overflowY="auto",t.classList.remove("chat_open"),l.innerHTML='<div class="chatbx_msg_l"><small class="welcome_message">Hello, my name is Autopulse, your AI automotive concierge.</small></div>',k="",lastUserInput="",lastFormData={},L&&g({userId:q,conversion_id:L,customerId:J()}),L="",clearTimeout(N),C=!1,H=!1,B&&localStorage.removeItem(B),localStorage.removeItem("chatbotRegisteredCustomer"),R(),e=j,document.body.style.overflow="unset",t=e.querySelector(".chatbx_main"),l=e.querySelector(".chatbx_req_info"),e=e.querySelector(".chatbx_fulldetail_info"),t&&(t.classList.remove("collapsed"),t.classList.remove("fullScreen")),l&&l.classList.remove("chatbxreq_show"),e&&e.classList.remove("chatbxdetails_show"),U(j))}),j.addEventListener("click",function(e){e.target.closest(".chatbx_close_no")&&(e=j.querySelector(".chatbx_window"),j.querySelector(".chatbx_close_conf").style.display="none",e.style.overflowY="auto")});var e=j.querySelector(".full_screen"),l=j.querySelector(".mini_a"),o=e.cloneNode(!0),o=(e.parentNode.replaceChild(o,e),l.cloneNode(!0)),e=(l.parentNode.replaceChild(o,l),j.querySelector(".full_screen")),o=j.querySelector(".mini_a"),l=(e.addEventListener("click",function(e){e.preventDefault(),j.querySelector(".chatbx_main").classList.toggle("fullScreen");{const t=j.querySelector(".chatbx_main"),l=j.querySelector(".explore_main");t&&l&&!t.classList.contains("fullScreen")&&l.classList.contains("listingCarsOpen")&&setTimeout(function(){l.style.height=l.clientHeight+"px"},400)}U(j),m()}),o.addEventListener("click",function(e){e.preventDefault(),j.querySelector(".chatbx_main").classList.toggle("chat_open")}),j.querySelector("#sendBtn")),e=(l&&l.addEventListener("click",function(){r()}),j.querySelector("#userInput")),a=(e&&(e.addEventListener("input",O),e.addEventListener("focus",O),e.addEventListener("click",O)),j.addEventListener("click",function(e){(e.target.closest("button")||e.target.closest("input")||e.target.closest("a")||e.target.closest(".btn_expand")||e.target.closest(".btn_exploere_more"))&&O(),(e.target.closest(".chatboxO_a")||e.target.closest(".mini_a")||e.target.closest(".full_screen")||e.target.closest(".chatbx_close_yes")||e.target.closest(".chatbx_close_no"))&&setTimeout(()=>{F()},100)}),window.addEventListener("beforeunload",function(){F()}),document.addEventListener("visibilitychange",function(){document.hidden&&F()}),setInterval(()=>{L&&C&&F()},3e4),e&&e.addEventListener("keypress",function(e){"Enter"===e.key&&r()}),window.triggerBookingPrompt=function(e=!1){e||n()?c(!0):c(!1)},window.appendBookingPrompt=c,window.shouldAutoEnableBooking=n,window.testAutoBooking=function(){c(!0)},!0);function s(){const e=j.querySelector("#chatOpenSound");e&&e.play().then(()=>{e.pause(),e.currentTime=0,t=!0}).catch(()=>{}),document.removeEventListener("pointerdown",s),document.removeEventListener("click",s),document.removeEventListener("touchstart",s),document.removeEventListener("keydown",s)}function r(){var t=j.querySelector("#userInput").value.trim();if(""!==(lastUserInput=t))if(C=C||!0,O(),E++,2e3<t.length)alert("Query should not be more than 2000 characters.");else{j.querySelector(".chatbx_response").innerHTML+=`<div class="chatbx_msg_r"><small>${t}</small><span class="ch_time">${D()}</span></div>`,j.querySelector("#userInput").value="",j.querySelector("#charCount").textContent="0/2000",j.querySelector("#loader").style.display="block",j.querySelector("#sendBtn").classList.add("chatbx_disable");let e={};var l=localStorage.getItem("chatbotRegisteredCustomer");if(l)try{e=JSON.parse(l)}catch(e){console.warn("Error parsing stored customer data:",e)}l={request:t,context:k||"",conversation_id:function(){if(B)try{var e=localStorage.getItem(B);if(e)return JSON.parse(e).conversation_id||null}catch(e){console.error("Failed to get conversation_id from storage:",e)}return null}()||L||"",dealerId:q,customerId:J(),booking_id:V(),customer_name:e.firstName&&e.lastName?e.firstName+" "+e.lastName:e.name||"",customer_email:e.email||"",customer_phone:e.phone||e.phone_number||"",booking_date:e.booking_date||"",booking_time:e.booking_time||"",current_url:window.location.href,page_title:document.title,referrer:document.referrer||"",user_agent:navigator.userAgent};fetch(window.baseurl+"api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(l)}).then(e=>e.json()).then(t=>{if(j.querySelector("#loader").style.display="none",j.querySelector("#sendBtn").classList.remove("chatbx_disable"),t){L=t.conversation_id,"Thank you for the question. This topic is beyond my training with providing support for automotive shoppers. I suggest using different resources. Are you interested in purchasing a new or pre-owned vehicle?"!==t.rawoutput&&(k+=t.rawoutput);var l=function(l){if(l&&l.response){let e;try{e=JSON.parse(l.response)}catch(e){return console.error("Failed to parse response as JSON:",e),"<p>"+l.rawoutput+"</p>"}if(!e||"object"!=typeof e)return"<p>"+l.rawoutput+"</p>";let t="";return e.heading&&(t+=`<h5>${e.heading}</h5>`),e.subheading&&(t+=`<h6>${e.subheading}</h6>`),e.paragraphs&&0<e.paragraphs.length&&e.paragraphs.forEach(e=>{t+=`<p>${e}</p>`}),e.list&&0<e.list.length&&(t+="<ul>",e.list.forEach(e=>{t+=`<li>${e}</li>`}),t+="</ul>"),t}return l.rawoutput}(t),o=t.html||"",l=l.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");j.querySelector(".chatbx_response").innerHTML+=`<div class="chatbx_msg_l"><small>${l}</small><span class="ch_time">${D()}</span></div>`;let e="";t.Message&&(e=t.Message),o&&(l=`
                                <div class="chatbx_car_card_main">
                                    <div class="owl-carousel owl-theme chatbx_cars_slides circular_nav">${o}</div><div>${e}</div>
                                    <span class="ch_time">${D()}</span>
                                </div>`,j.querySelector(".chatbx_response").innerHTML+=l),5==E&&c(!1),t.booking_enable&&c(!0),t.updated_customer_id&&(A=t.updated_customer_id),m(),p(),j.querySelector(".chatbx_window").scrollTop=j.querySelector(".chatbx_window").scrollHeight,F()}else h("Failed to fetch data from the API")}).catch(e=>{console.error("Error:",e),h("Error fetching chatbot response"),F()})}}function p(){j.querySelectorAll(".btn_expand").forEach(e=>{e.removeEventListener("click",v),e.addEventListener("click",function(){v(e)})}),j.querySelectorAll(".btn_exploere_more").forEach(e=>{e.removeEventListener("click",u),e.addEventListener("click",function(){u(e)})})}function c(e=!1){const t="prompt_"+Date.now();var l=`
                    <div class="chatbx_msg_l" id="${t}">
                        <small>Would you like me to help schedule an appointment to view our inventory in person?</small>
                        <div class="calendr">
                            <button class="calendr_yes_btn" data-prompt-id="${t}">
                                <img src="${window.baseurl}assets/images/booking/schedule.png" alt="schedule" class="calendr_icon">
                                <small class="calendr_yes">Yes</small>
                            </button>
                            <button class="calendr_no_btn" data-prompt-id="${t}">
                                <small class="calendr_no">No</small>
                            </button>
                        </div>
                    </div>`;j.querySelector(".chatbx_response").innerHTML+=l;const o=j.querySelector(`#${t} .calendr_yes_btn`),a=j.querySelector(`#${t} .calendr_no_btn`);o&&o.addEventListener("click",()=>{j.querySelector(".chatbx_response").innerHTML+=`<div class="chatbx_msg_r"><small>Yes</small><span class="ch_time">${D()}</span></div>`,d(t),o.disabled=!0,a.disabled=!0,m(),p()}),a&&a.addEventListener("click",()=>{j.querySelector(".chatbx_response").innerHTML+=`<div class="chatbx_msg_r"><small>No</small><span class="ch_time">${D()}</span></div>`,o.disabled=!0,a.disabled=!0,m(),p()}),!0===e&&(l=`<div class="chatbx_msg_r"><small>Auto-scheduling appointment...</small><span class="ch_time">${D()}</span></div>`,j.querySelector(".chatbx_response").innerHTML+=l,setTimeout(()=>{o&&(o.innerHTML='<small class="calendr_yes">Scheduling...</small>',o.disabled=!0,a.disabled=!0),setTimeout(()=>{try{d(t)}catch(e){console.error("Error in auto-trigger displayBookingForm:",e),o&&o.click()}},300)},300))}function n(){var e=window.chatbotData&&window.chatbotData.vehicle_interest,t=window.chatbotData&&5<window.chatbotData.conversation_length,l=window.chatbotData&&window.chatbotData.inventory_questions;return e&&t||l}function d(h){var e=(new Date).toISOString().split("T")[0],t="bookingForm_"+h,{email:l="",phone:o="",firstName:a="",lastName:s=""}=JSON.parse(localStorage.getItem("chatbotRegisteredCustomer")||"{}"),t=`
                    <div class="chatbx_msg_l" id="${t}" style="display:block;">
                        <div class="time_slot_bx">
                            <form id="form_${h}" class="bookingForm" data-prompt-id="${h}">
                                <p><small>Please <b>select slot</b></small></p>
                                <div class="input-group align-items-center flex-nowrap mb-2">
                                    <input type="date" id="bookingDate_${h}" class="form-control" placeholder="Select date" min="${e}">
                                    <input type="time" id="bookingTime_${h}" class="form-control" placeholder="Select time">
                                </div>
            
                                <p><small>What's your <b>name & email</b>?</small></p>
                                <div class="form-group">
                                    <input type="text" id="bookingName_${h}" value ="${a} ${s}" class="form-control" placeholder="Name">
                                    <input type="email" id="bookingEmail_${h}" value ="${l}" "phone" class="form-control mt-1" placeholder="Email">
                                    <input type="text" id="bookingPhone_${h}"  value ="${o}" class="form-control mt-1" placeholder="Phone">
                                </div>
                                <button type="submit" class="btn_chatbx_fill w-100 mt-2">Send</button>
                            </form>
                        </div>
                    </div>`;j.querySelector(".chatbx_response").innerHTML+=t,j.querySelector(".chatbx_window").scrollTop=j.querySelector(".chatbx_window").scrollHeight,j.querySelector(".chatbx_response").addEventListener("submit",t=>{var l=t.target;if(l.id==="form_"+h){t.preventDefault();{var t=l,l=h,o=j.querySelector("#bookingDate_"+l).value.trim(),a=j.querySelector("#bookingTime_"+l).value.trim(),s=j.querySelector("#bookingName_"+l).value.trim(),i=j.querySelector("#bookingEmail_"+l).value.trim(),r=j.querySelector("#bookingPhone_"+l).value.trim();t.querySelectorAll(".form-control").forEach(e=>{e.classList.remove("error")});let e=!0;if(o||(e=!1,j.querySelector("#bookingDate_"+l).classList.add("is-invalid")),r||(e=!1,j.querySelector("#bookingPhone_"+l).classList.add("is-invalid")),a||(e=!1,j.querySelector("#bookingTime_"+l).classList.add("is-invalid")),s||(e=!1,j.querySelector("#bookingName_"+l).classList.add("is-invalid")),i&&function(e){return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)}(i)||(e=!1,j.querySelector("#bookingEmail_"+l).classList.add("is-invalid")),e){var c={booking_date:o,booking_time:a,name:s,email:i,phone_number:r,dealer_id:q,conversation_id:L,current_url:window.location.href,page_title:document.title,referrer:document.referrer||""},n=l;const d=window.baseurl+"api/bookings",u=j.getElementById("widget_loader-overlay");u.style.display="flex",fetch(d,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(c)}).then(e=>{if(e.ok)return e.json();throw new Error("HTTP error! Status: "+e.status)}).then(e=>{var t,l,o,a;e.success?(t=`
                            <div class="chatbx_msg_r" style="display:block;">
                                <p class="mb-1"><small>Your appointment has been booked. Here are the details -</small></p>
                                <small class="text-start">
                                    <b>Date: </b>${c.booking_date}<br>
                                    <b>Time: </b>${c.booking_time}<br>
                                    <b>Name: </b>${c.name}<br>
                                    <b>Email: </b>${c.email}<br>
                                    <b>Phone: </b>${c.phone_number}<br>
                                </small>
                            </div>`,I=1,!localStorage.getItem("chatbotRegisteredCustomer")&&e.data&&(l=c.name,o=c.email,a=c.phone_number,A=e.data.user_id,l={customerId:e.data.user_id,name:l,email:o,phone:a,booking_date:c.booking_date,booking_time:c.booking_time,registrationDate:(new Date).toISOString(),vehicleInfo:{vin:e.data.vin||"",make:e.data.make||"",model:e.data.model||"",year:e.data.year||""}},localStorage.setItem("chatbotRegisteredCustomer",JSON.stringify(l))),T=e.data.id,o=n,(a=j.querySelector("#form_"+o))?(a.querySelectorAll(".form-control, button").forEach(e=>{e.disabled=!0,e.classList.add("disabled")}),a.insertAdjacentHTML("beforeend",'<small class="form-disabled-message" style="color: gray; display: block; margin-top: 10px;">This form is now disabled.</small>')):console.warn(`Form with ID form_${o} not found.`),j.querySelector(".chatbx_response").innerHTML+=t,j.querySelector(".chatbx_window").scrollTop=j.querySelector(".chatbx_window").scrollHeight):(l=`
                            <div class="chatbx_msg_r">
                                <small>Failed to save booking. Please try again.</small>
                                <span class="ch_time">${D()}</span>
                            </div>`,j.querySelector(".chatbx_response").innerHTML+=l,j.querySelector(".chatbx_window").scrollTop=j.querySelector(".chatbx_window").scrollHeight,console.warn("API responded with failure:",e))}).catch(e=>{console.error("Error saving booking:",e);e=`
                        <div class="chatbx_msg_r">
                            <small>An error occurred. Please try again later.</small>
                            <span class="ch_time">${D()}</span>
                        </div>`;j.querySelector(".chatbx_response").innerHTML+=e,j.querySelector(".chatbx_window").scrollTop=j.querySelector(".chatbx_window").scrollHeight}).finally(()=>{m(),p(),u.style.display="none"})}}}}),m(),p()}function u(e){apiurl=$(e).attr("data_href"),j.apiresult(apiurl),_(clickdata={conversion_id:L,action:"Explore_more",otherdetail:apiurl,source:q})}function h(e){var t=j.querySelector(".chatbx_response");t.innerHTML+=`
                    <div class="chatbx_msg_l">
                        <small>${e}</small><span class="ch_time">${D()}</span>
                        <a id="resendBtn" class="px-2 resend_btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-rotate-cw"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                        &nbsp;Resend</a>
                    </div>`,t.scrollTop=t.scrollHeight,j.querySelector("#resendBtn").addEventListener("click",function(){""!==lastUserInput&&(j.querySelector("#userInput").value=lastUserInput,r())})}function m(){j.querySelectorAll(".chatbx_cars_slides").forEach(e=>{var t=e.parentElement.querySelector(".owl-nav"),l=e.parentElement.querySelector(".owl-dots"),t=(t&&t.remove(),l&&l.remove(),$(e).hasClass("owl-loaded")&&$(e).trigger("destroy.owl.carousel"),window.innerWidth),l={items:1,loop:!1,margin:10,dots:!1,mouseDrag:!1,touchDrag:!1,nav:!0,navText:['<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-left"><polyline points="15 18 9 12 15 6"></polyline></svg>','<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-right"><polyline points="9 18 15 12 9 6"></polyline></svg>']},o=j.querySelector(".chatbx_main");o&&o.classList.contains("fullScreen")&&(1500<t?l.items=4:991<t?l.items=3:600<t&&(l.items=2)),$(e).owlCarousel(l)})}function v(e){e=JSON.parse(e.getAttribute("data_attr")),organizedFeatures={},e=window.baseurl+("api/vehicledetail/"+(e.id??""));const t=j.getElementById("widget_loader-overlay");t.style.display="flex",fetch(e,{method:"GET"}).then(e=>e.json()).then(e=>{let t=e.listings[0];e=j.getElementById("chatbx_car_details");t&&t.extra&&t.extra.high_value_features&&t.extra.high_value_features.forEach(e=>{var t=e;organizedFeatures[t]||(organizedFeatures[t]=[]),organizedFeatures[t].push(e)}),t?.media?.photo_links?.[0];const l=`${t?.build?.year??""} ${t?.build?.make??""} `+(t?.build?.model??"");var o=`${t?.dealer?.city??""}, `+(t?.dealer?.state??""),a=t?.price?"$"+Math.floor(t.price).toLocaleString("en-US"):"N/A";let s="";t.is_certified&&(s=` <div class="certified_badge">
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffd43b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-award"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>
                                                        </div>`);var{email:i="",phone:r="",firstName:c="",lastName:n=""}=JSON.parse(localStorage.getItem("chatbotRegisteredCustomer")||"{}"),a=`
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
                                                <div class="main_slider">${s}
                                                    <!-- All photos -->
                                                     <!-- <div class="view_all_photos">
                                                        <a class="all_photos">All Photos</a>
                                                    </div> -->
                                                    <div id="big" class="owl-carousel owl-theme">
                                                        ${t.media.photo_links.map(e=>`
                                                        <div class="item">
                                                            <a href="${e}" data-lightbox="gallery" data-title="${l}">
                                                                <img src="${e}" alt="">
                                                            </a>
                                                        </div>`).join("")}
                                                    </div>
                                                </div>
                    
                                                <div id="thumbs" class="owl-carousel owl-theme thumbnail_imgs">
                                                    ${t.media.photo_links.map(e=>`
                                                    <div class="item">
                                                        <img src="${e}" alt="">
                                                    </div>`).join("")}
                                                </div>
                                            </div>
                        
                                                <div class="car_details_right_top mb-2">
                                                    <div class="car_details_right_inn">
                                                        <div class="car_details_spec">
                                                            <span class="car_year">${t.inventory_type??"NA"}</span>
                                                            <div class="position-relative">
                                                                <div class="car_loc ms-0 w-100">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-map-pin"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                                                                    <span>${o}</span>
                                                                </div>
                                                                ${t.dealer.call_track_number?`
                                                                <div class="car_loc ms-0 w-100 mt-1">
                                                                    <a href="tel:${t.dealer.call_track_number}" class="btn btn_blue ms-auto click_call_btn">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-phone"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                                                        <span>${t.dealer.call_track_number}</span>
                                                                    </a>
                                                                </div>`:""}
                                                            </div>
                                                        </div>
                                                        <div class="car_title_price_specs">
                                                            <h4>${l}</h4>
                                                            <div class="car_spec_short">
                                                                <span>${t.miles?t.miles.toString().replace(/\B(?=(\d{3})+(?!\d))/g,","):"N/A"} Miles</span>&nbsp;|&nbsp;
                                                                <span>${t.build.fuel_type??"NA"}</span>&nbsp;|&nbsp;
                                                                <span>${t.build.transmission??"NA"}</span>
                                                            </div>
                                                            <div class="price_sms d-flex align-items-center mb-3">
                                                                <h5 class="mb-0">${a}</h5>
                                                                ${t.dealer.call_track_sms?`
                                                                <a href="sms:+${t.dealer.call_track_sms}&&body=${encodeURIComponent(o.href)}" id="share-sms" class="d-md-none btn btn_blue ms-auto">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-message-circle"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                                                                    <span>Text Message</span>
                                                                </a>`:""}
                                                            </div>
                                                        </div>
                                                            <a href="${t.vdp_url??""}?utm_source=Autopulse+&utm_medium=Autopulse&utm_campaign=Autos" target="_blank" class="btn_chatbx_fill w-100 view_dealer_website">View Dealer Website</a>
                                                        <!--a href="javascript:;" class="btn btn_theme w-100" onclick="triggerViewdetail(this, '${t.vin}')">Request Contact from Dealer</a-->
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
                                                            <input type="hidden" name="vid" id="vid"  value="${t.id}">
                                                               <input type="hidden" name="vin" id="vin"  value="${t.vin}">
                                                            <input type="hidden" name="latitude" id="request_latitude" value="">
                                                            <input type="hidden" name="longitude" id="request_longitude" value="">
                                                            <input type="hidden" name="city" id="request_city" value="">
                                                            <input type="hidden" name="country" id="request_country" value="">
                                                                <input type="hidden" name="dealerId" id="rqeust_dealerId" value="${q}">
                                                            <div class="row g-2">
                                                                <div class="col col-6">
                                                                    <div class="position-relative">
                                                                        <input type="text" name="first_name" id="first_name" value="${c}" placeholder="First Name" class="form-control required">
                                                                    </div> 
                                                                </div>
                                                                <div class="col col-6">
                                                                    <div class="position-relative">
                                                                        <input type="text" name="last_name" id="last_name" value="${n}" placeholder="Last Name" class="form-control required">                                            
                                                                    </div> 
                                                                </div>
                                                                <div class="col col-12">
                                                                    <div class="position-relative">
                                                                        <input type="text"  placeholder="Zip code" name="zip_code" id="request_zip_code" class="form-control required">
                                                                    </div> 
                                                                </div>
                                                                <div class="col col-12">
                                                                    <div class="position-relative">
                                                                        <input type="text" name="email" id="regvinEmail" placeholder="Email"  value="${i}" class="form-control required">
                                                                    </div> 
                                                                </div>
                                                                <div class="col col-12">
                                                                    <div class="position-relative">
                                                                        <input type="text" name ="phone_number" id="regphone_number" placeholder="Phone" value="${r}" class="form-control required">
                                                                        <input type="hidden" id="request_vin" name ="vin" placeholder="Phone" value="${t.vin}" class="form-control required">
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
                                                    <!--a href="${t.vdp_url??""}" target="_blank" class="view_dealerWeb">View Dealer Website</a-->
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
                                                                        <p><span>${t.vin??"NA"}</span>
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
                                                                        <p>${t.build.year??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Make</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.make??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Model</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.model??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Trim</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.trim??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Engine</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.engine??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Transmission</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.transmission??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Body type</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.body_type??"NA"}</p>
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
                                                                        <p>${t.exterior_color??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Interior Color</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.interior_color??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Vehicle Type</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.vehicle_type??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Drive Train</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.drivetrain??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Fuel Type</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.fuel_type??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Engine Size</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.engine_size??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Doors</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.doors??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Cylinders</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.cylinders??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Height</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.overall_height??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Length</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.overall_length??"NA"}</p>
                                                                    </div>
                                                                </div>                                
                                                            </li>
                                                            <li class="col col-12">
                                                                <div class="row g-0">
                                                                    <div class="col col-xl-6 col-md-5 col-6 specs_left">
                                                                        <p>Width</p>
                                                                    </div>
                                                                    <div class="col col-xl-6 col-md-7 col-6 specs_right">
                                                                        <p>${t.build.overall_width??"NA"}</p>
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
                                                        ${Object.entries(organizedFeatures??{}).map(([e,t],l)=>`
                                                        <div class="accordion-item">
                                                            <h2 class="accordion-header" id="${e}-heading">
                                                                <button class="accordion-button ${0!==l?"collapsed":""}" type="button" data-bs-toggle="collapse" data-bs-target="#${e.replace(/[^a-zA-Z0-9_]/g,"_")}" aria-expanded="${0===l}" aria-controls="${e.replace(/[^a-zA-Z0-9_]/g,"_")}">
                                                                    ${e}
                                                                </button>
                                                            </h2>
                                                            <div id="${e.replace(/[^a-zA-Z0-9_]/g,"_")}" class="accordion-collapse collapse ${0===l?"show":""}" aria-labelledby="${e}-heading" data-bs-parent="#detailedFeatures">
                                                                <div class="accordion-body">
                                                                    <div class="features_list">
                                                                        <ul class="row">
                                                                            ${t.map(e=>`
                                                                            <li class="col col-12">
                                                                                <div class="feature_inn">
                                                                                    <p>
                                                                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-check-circle"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                                                                        ${e}</p>
                                                                                </div>
                                                                            </li>`).join("")}
                                                                        </ul>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>`).join("")}
                                                    </div>
                                                </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            `;e.innerHTML=a,j.querySelector(".chatbx_fulldetail_info").classList.add("chatbxdetails_show"),(o=j.querySelector(".chatbx_main")).classList.contains("collapsed")&&o.classList.remove("collapsed"),o.classList.add("collapsed"),W(j),j.querySelectorAll(".accordion-button").forEach(l=>{l.addEventListener("click",function(){var e=l.getAttribute("data-bs-target"),e=j.querySelector(e);if(e.classList.contains("show"))e.classList.remove("show"),l.classList.add("collapsed");else{const t=j.querySelector(l.getAttribute("data-bs-parent"));t&&t.querySelectorAll(".accordion-collapse.show").forEach(e=>{e.classList.remove("show"),t.querySelector(`[data-bs-target="#${e.id}"]`).classList.add("collapsed")}),e.classList.add("show"),l.classList.remove("collapsed")}})});{const u=j.querySelector("#shadow-lightbox"),h=j.querySelector("#lightbox-image"),p=j.querySelector("#lightbox-close"),m=j.querySelector("#lightbox-prev"),v=j.querySelector("#lightbox-next");let l=0,o=[];const g=j.querySelectorAll("a[data-lightbox]");g.forEach((e,t)=>{e.addEventListener("click",function(e){e.preventDefault(),o=Array.from(g),l=t;e=this.getAttribute("href");e&&(h.src=e,u.style.display="flex")})}),p.addEventListener("click",function(){u.style.display="none"}),m.addEventListener("click",function(){l=0<l?l-1:o.length-1,h.src=o[l].getAttribute("href")}),v.addEventListener("click",function(){l=l<o.length-1?l+1:0,h.src=o[l].getAttribute("href")}),u.addEventListener("click",function(e){e.target===u&&(u.style.display="none")})}setTimeout(function(){{const t=j.querySelector("#big"),e=j.querySelector("#thumbs");$(t).owlCarousel({items:1,slideSpeed:2e3,nav:!1,autoplay:!1,dots:!1,loop:!0,responsiveRefreshRate:200}).on("changed.owl.carousel",f(y,200)),$(e).owlCarousel({items:5,dots:!1,nav:!0,navText:['<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-left"><polyline points="15 18 9 12 15 6"></polyline></svg>','<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-chevron-right"><polyline points="9 18 15 12 9 6"></polyline></svg>'],smartSpeed:200,slideSpeed:500,slideBy:4,margin:5,responsiveRefreshRate:100,responsiveClass:!0,responsive:{0:{items:3,margin:6,nav:!1},600:{items:3,margin:8},1e3:{items:5,margin:8},1200:{items:5}}}).on("changed.owl.carousel",f(b,200)),$(e).on("click",".owl-item",function(e){e.preventDefault();e=$(this).index();$(t).data("owl.carousel").to(e,300,!0)})}},400),j.querySelectorAll(".chatbxfulldetail_show_btn").forEach(e=>{e.addEventListener("click",function(){var e=(t=j).querySelector(".chatbx_main"),t=t.querySelector(".chatbx_fulldetail_info");e&&e.classList.remove("collapsed"),t&&t.classList.remove("chatbxdetails_show")})});c=j.getElementById("savereadfrequestBtn");function d(e){var e=j.querySelector(e),t=j.querySelector(".chatbx_detail_full");e&&t&&t.scrollTo({top:e.getBoundingClientRect().top-t.getBoundingClientRect().top+t.scrollTop,behavior:"smooth"})}c&&c.addEventListener("click",function(){savereadfrequest(j)});n=j.querySelector(".overviewtab"),i=j.querySelector(".specificationstab"),r=j.querySelector(".featurestab"),n&&n.addEventListener("click",function(){d("#overview")}),i&&i.addEventListener("click",function(){d("#specifications")}),r&&r.addEventListener("click",function(){d("#features")}),_(clickdata={conversion_id:L,action:"View_Vehicle",vin:t.vin,source:q}),e=j.querySelector(".view_dealer_website");e&&e.addEventListener("click",function(){_({conversion_id:L,action:"Visit_dealer_website",vin:t.vin,source:q})})}).catch(e=>console.error("Error:",e)).finally(()=>{t.style.display="none"})}function _(e){var e={...e,current_url:window.location.href,page_title:document.title,referrer:document.referrer||"",timestamp:(new Date).toISOString()},t=baseurl+"api/bot-click-action";fetch(t,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)}).then(e=>e.json()).then(e=>{}).catch(e=>{console.error("Error:",e)})}function b(e){var t;a&&(e=e.item.index,t=j.querySelector("#big"),$(t).data("owl.carousel").to(e,100,!0))}function y(e){var t=e.item.count-1;let l=Math.round(e.item.index-e.item.count/2-.5);(l=l<0?t:l)>t&&(l=0);var e=j.querySelector("#thumbs"),t=($(e).find(".owl-item").removeClass("current").eq(l).addClass("current"),$(e).find(".owl-item.active").length-1),o=$(e).find(".owl-item.active").first().index(),a=$(e).find(".owl-item.active").last().index();l>a&&$(e).data("owl.carousel").to(l,100,!0),l<o&&$(e).data("owl.carousel").to(l-t,100,!0)}function f(t,l){let o;return function(...e){clearTimeout(o),o=setTimeout(()=>t.apply(this,e),l)}}function g(e){var t=baseurl+"api/close_conversion",e=new URLSearchParams(e).toString();navigator.sendBeacon(t+"?"+e)}function x(i,r){const c=r.getElementById("widget_loader-overlay");c.style.display="flex";var e=new FormData(i),t=window.baseurl+"api/vehicel/adfMail",t=(fetch(t,{method:"POST",body:e}).then(e=>e.json()).then(e=>{var t,l;c.style.display="none",i.style.display="none",!localStorage.getItem("chatbotRegisteredCustomer")&&e.data&&(l=r.getElementById("first_name")?.value||"",o=r.getElementById("last_name")?.value||"",a=r.getElementById("regvinEmail")?.value||"",t=r.getElementById("regphone_number")?.value||"",A=e.data.user_id,l={customerId:e.data.user_id,firstName:l,lastName:o,email:a,phone:t,registrationDate:(new Date).toISOString(),vehicleInfo:{vin:e.data.vin||"",make:e.data.make||"",model:e.data.model||"",year:e.data.year||""}},localStorage.setItem("chatbotRegisteredCustomer",JSON.stringify(l)));{var o="Your request has been submitted successfully.",a=i;const s=document.createElement("div");s.classList.add("alert","alert-success"),s.textContent=o,a.parentNode.insertBefore(s,a.nextSibling),setTimeout(()=>s.remove(),5e3)}}).catch(e=>{console.error("Error submitting form:",e),c.style.display="none"}),vin=r.getElementById("request_vin"),{conversion_id:L,action:"Vin_Reqeust_form",source:q,vin:vin});_(t)}function w(){j.submitForm()}window.addEventListener("beforeunload",function(e){window.baseurl;L&&(g({userId:q,conversion_id:L}),e.preventDefault(),e.returnValue="")}),window.savereadfrequest=function(a){const s=a.getElementById("validaterequest");var e,i;!function(e){let t=!0;e=e.querySelectorAll(".required");return e.forEach(e=>{""===e.value.trim()?(t=!1,e.classList.add("is-invalid")):e.classList.remove("is-invalid")}),t}(s)||((e=s.querySelector("#request_zip_code").value)?(i=function(e,t,l,o){s.querySelector("#request_latitude").value=e,s.querySelector("#request_longitude").value=t,s.querySelector("#request_city").value=l,s.querySelector("#request_country").value=o,x(s,a)},fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${e}&key=AIzaSyBaVOhSLQc7xrVpxgbuh-jJbxRLbJFqDiA`).then(e=>e.json()).then(e=>{var t,l,o;"OK"===e.status&&0<e.results.length?(t=e.results[0].geometry.location.lat,l=e.results[0].geometry.location.lng,o=e.results[0].address_components.find(e=>e.types.includes("locality")).long_name,e=e.results[0].address_components.find(e=>e.types.includes("country")).short_name,i(t,l,o,e)):alert("Invalid ZIP code. Please enter a valid ZIP code.")}).catch(e=>{alert("An error occurred while validating the ZIP code. Please try again.")})):x(s,a))},j.addEventListener("click",function(e){if(e.target.classList.contains("copyButton")){var t=e.target.previousElementSibling.textContent,l=document.createElement("input");j.appendChild(l),l.value=t,l.select(),document.execCommand("copy"),j.removeChild(l);const o=document.createElement("small");o.id="message",o.classList.add("text-success","m-0","d-block"),o.textContent="Copied to clipboard";l=e.target.parentNode.querySelector("#message"),l=(l&&l.remove(),e.target.parentNode.appendChild(o),{conversion_id:L,action:"vin_copy",vin:t,source:q});_(l),setTimeout(function(){o.remove()},3e3)}}),j.addEventListener("click",function(e){(e.target.closest("input[type='checkbox']")||e.target.closest("select"))&&w()}),j.addEventListener("change",function(e){var t;"sorting"===e.target.id&&(t=j.querySelector("#sorting").value,(e=e.target.value)!==t)&&(t=e,w())}),j.addEventListener("click",function(e){var t,l;e.target.matches(".pagination a")&&(e.preventDefault(),t=e.target.href,j.apiresult(t)),e.target.matches(".listing_filter_collapse")&&(l=j.querySelector(".explore_main"))&&l.classList.toggle("listingFilterOpen"),e.target.matches(".listing_cars_back")&&(l=j.querySelector(".explore_main"))&&l.classList.remove("listingCarsOpen")}),j.apiresult=function(e){const t=j.getElementById("widget_loader-overlay");t.style.display="flex",fetch(e,{method:"GET"}).then(e=>e.json()).then(e=>{var t;e.html&&(j.getElementById("explore_main").innerHTML=e.html,(t=j).makemileagerange=function(){var e=t.querySelector("#minMileage").value.replace(/\$/g,"").replace(/,/g,"")+" - "+t.querySelector("#maxMileage").value.replace(/\$/g,"").replace(/,/g,"");t.querySelector("#miles_range").value=e,t.submitForm()},t.makeyearrange=function(){var e=t.querySelector("#minYear").value.replace(/\$/g,"").replace(/,/g,"")+" - "+t.querySelector("#maxYear").value.replace(/\$/g,"").replace(/,/g,"");t.querySelector("#year_range").value=e,t.submitForm()},t.makepricerange=function(){var e=t.querySelector("#minPrice").value.replace(/\$/g,"").replace(/,/g,"")+" - "+t.querySelector("#maxPrice").value.replace(/\$/g,"").replace(/,/g,"");t.querySelector("#price_range").value=e,t.submitForm()},t.querySelectorAll('[data-action="makemileagerange"]').forEach(function(e){e.addEventListener("click",function(){t.makemileagerange()})}),t.querySelectorAll('[data-action="makeyearrange"]').forEach(function(e){e.addEventListener("click",function(){t.makeyearrange()})}),t.querySelectorAll('[data-action="makepricerange"]').forEach(function(e){e.addEventListener("click",function(){t.makepricerange()})}),j.querySelectorAll('[data-bs-toggle="collapse"]').forEach(t=>{t.addEventListener("click",function(e){e.preventDefault();e=t.getAttribute("href")||t.getAttribute("data-bs-target"),e=j.querySelector(e);e&&(e.classList.contains("show")?(e.classList.remove("show"),t.classList.add("collapsed")):(e.classList.add("show"),t.classList.remove("collapsed")))})}),j.querySelectorAll(".btn_expand").forEach(e=>{e.addEventListener("click",function(){v(e)})}),e=j.querySelector(".explore_main"))&&(e.classList.add("listingCarsOpen"),setTimeout(function(){U(j)},400))}).catch(e=>console.error("Error:",e)).finally(()=>{t.style.display="none"})},U(j)}else console.error("User ID not found in the script URL.")}function W(e){var t=e.querySelector(".chatbx_fulldetail_info"),l=e.querySelector(".chatbx_fulldetail_info .chatbx_subhead"),e=e.querySelector(".chatbx_detail_full");t&&l&&e&&(t=t.clientHeight-l.clientHeight,e.style.minHeight=t+"px",e.style.maxHeight=t+"px")}j.innerHTML=`
            <style>${e}</style>
            ${`
            <div class="position-relative chatboxAi">
                <div class="chatboxO chatbox_ri">
                    <div class="banner_chatbox_o">
                        <a class="chatboxO_a_main">
                            <span class="banner_chatbox_text" id="chatbot-name"></span>
                            <span class="banner_chatbox_icon">
                                <img src="" id="chatbot-logo" alt="chat" class="img-fluid" style="display: none;">
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
        `}
        `,(r()?(j.querySelector(".chatbx_body").classList.add("chatbxbody_chat"),u):(j.querySelector(".chatbx_body").classList.add("chatbxbody_reg"),i))(),j.submitForm=function(){var e=j.getElementById("searchinput");e?(e=new FormData(e),e=new URLSearchParams(e).toString(),e=baseurl+"api/vehicle?"+e,j.apiresult(e)):console.error('Form element with id "searchinput" not found.')},o("https://code.jquery.com/jquery-3.7.1.min.js",function(){o("https://cdn.jsdelivr.net/npm/@popperjs/core@2.11.6/dist/umd/popper.min.js",function(){o("https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.min.js",function(){o("https://cdnjs.cloudflare.com/ajax/libs/OwlCarousel2/2.3.4/owl.carousel.min.js",h)})})})}();