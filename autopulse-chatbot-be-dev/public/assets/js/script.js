$(document).ready(function() {
    var screenWidth = $(window).width();
    var screenHeight = $(window).height();
    
    console.log("Screen Resolution: " + screenWidth + "x" + screenHeight);

    $("#single").select2({
        placeholder: "Select Make",
        allowClear: false
    });
    $(".multi1").select2({
        placeholder: "Assign Store",
        allowClear: false
    });
    $(".multi2").select2({
        placeholder: "Assign Store"
    });
    $("#single2").select2({
        placeholder: "Select Model",
        allowClear: false
    });
});

// Listing Filter menu
if(window.innerWidth < 991){
    const offsetmenu = document.getElementById('mobMenu');
    if(offsetmenu != null){
        offsetmenu.style.height = window.innerHeight + "px";
    }
}

// Toggle Mobile Menu
var toggleButton = document.getElementById("mobMenuBtn");
var element = document.getElementById("mobMenu");
if(toggleButton != null && element != null){
    toggleButton.addEventListener("click", function() {
        if (element.classList.contains("open")) {
          element.classList.remove("open");
        } 
    });      
}

// Header Sticky
$(window).scroll(function(){
    var sticky = $('.main_header'),
        scroll = $(window).scrollTop();
  
    if (scroll >= 30) sticky.addClass('fixed-top');
    else sticky.removeClass('fixed-top');
});

// Home Banner
var windowHeight = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
var yourElement = document.getElementById("home_banner");
var main_header = document.getElementById("main_header");
var subpageMt = document.getElementById("subpage_mt");
var carDetailsRight = document.getElementById("car_details_right");
var detailsInfoTabs = document.getElementById("details_info_tabs");
var carDetailsSlider = document.getElementById("car_details_slider");
var accountMenu = document.getElementById("account_menu");
var accPageHead = document.getElementById("acc_page_head");

// if(window.innerWidth > 991 && yourElement != null){
if(yourElement != null){
    // yourElement.style.height = (windowHeight-main_header.clientHeight) + "px";
    yourElement.style.marginTop = main_header.clientHeight + "px";
} else if(subpageMt != null){
    subpageMt.style.marginTop = main_header.clientHeight + "px";
}

// Car Details Right box & Tabs
if(carDetailsRight != null && detailsInfoTabs != null){
    if(window.innerWidth > 610){
        carDetailsRight.style.top = ((main_header.clientHeight) + 15) + "px";
    } 
    detailsInfoTabs.style.top = (main_header.clientHeight - 6) + "px";
} 

// Account Menu
if(accountMenu != null && accPageHead != null){
    if(window.innerWidth > 991){
        accountMenu.style.top = ((main_header.clientHeight) + 15) + "px";
    } 
    accPageHead.style.top = ((main_header.clientHeight) - 5) + "px";

} 

// Car Details Page Tabs
$(document).ready(function() {
    // $(window).scroll(function() {
    //     var overview = $('#overview').offset().top - $(window).scrollTop();
    //     var scrolltTop = $('.details_info_tabs').innerHeight() + main_header.clientHeight;
    // });

    $('.overviewtab').click(function() {
        $('html, body').scrollTop(($('#overview').offset().top)-($('.details_info_tabs').innerHeight() + main_header.clientHeight));
    });
    $('.specificationstab').click(function() {
        $('html, body').scrollTop(($('#specifications').offset().top)-($('.details_info_tabs').innerHeight() + main_header.clientHeight));
    });
    $('.featurestab').click(function() {
        $('html, body').scrollTop(($('#features').offset().top)-($('.details_info_tabs').innerHeight() + main_header.clientHeight));
    });
    $('.recommendedtab').click(function() {
        $('html, body').scrollTop(($('#recommended').offset().top)-($('.details_info_tabs').innerHeight() + main_header.clientHeight));
    });
});

// Container - Trusted Used Cars by Price
var container = document.getElementById("container");
var customContainer = document.getElementById("cusContainer");
if(window.innerWidth > 1100 && customContainer != null){
    customContainer.style.width = (((window.innerWidth - container.offsetWidth)/2) + container.offsetWidth)-24 + "px";
} else if(customContainer != null){
    customContainer.style.width = container.offsetWidth;
}

// Autopulse popup
$(document).ready(function() {
    $('#autopopimg').on('load', function() {
        $(this).fadeIn(); // Show the image
        $(this).siblings('.autopopimgloader').fadeOut(); // Hide the loader
    }).each(function() {
        if (this.complete) $(this).trigger('load');
    });
});

if(localStorage.getItem('popupDisplayed') === null){
    function showPopup() {
        localStorage.setItem('popupDisplayed', 'true');
        var popupModal = new bootstrap.Modal(document.getElementById('autoModal'));
        popupModal.show();
        var modaloverlay = document.getElementById('overlay');
        if(modaloverlay){
            modaloverlay.style.display = 'block';
        }
    
    }
    
    // Function to hide the popup
    function hidePopup() {
        var popupModal = bootstrap.Modal.getInstance(document.getElementById('autoModal'));
        popupModal.hide();
        var modaloverlay = document.getElementById('overlay');
        if(modalover){
            modaloverlay.style.display = 'none';
        }
    }
    
    // Check if the user has visited before
    if (!localStorage.getItem('popupDisplayed')) {
        // Show the popup
        showPopup();
        // Set a flag in local storage to remember that the popup was shown
        localStorage.setItem('popupDisplayed', 'true');
    }
    
    // Event listener to close the popup
    var modalclse = document.getElementById('closePopup');
    if(modalclse){
        document.getElementById('closePopup').addEventListener('click', hidePopup);
    }
}

// Toggle Like Icon
document.addEventListener('DOMContentLoaded', function() {
    // JavaScript to change Font Awesome icon on checkbox checked
    const checkbox = document.getElementById('btn-check');
    const heartIcon = document.getElementById('heart-icon');
    if(heartIcon){
        checkbox.addEventListener('change', function () {
            if (this.checked) {
                heartIcon.classList.remove('far'); // Remove outline style
                heartIcon.classList.add('fas');    // Add solid style
            } else {
                heartIcon.classList.remove('fas'); // Remove solid style
                heartIcon.classList.add('far');    // Add outline style
            }
        });
    }
});
function makeFavourite(obj,vid,vin,url){
   
    formData ={vid:vid,vin:vin};
    runajax(url, formData, 'get', '', 'json', function(output) {
    const checkbox = document.getElementById('btn-check_'+vin);
    const heartIcon = document.getElementById('heart-icon_'+vin);
      
        if (output.success) 
        {
          
            if (output.data.status ==1) {
                console.log('far')
                heartIcon.classList.remove('far'); // Remove outline style
                heartIcon.classList.add('fas');    // Add solid style
            } else {
                console.log('fas')
                heartIcon.classList.remove('fas'); // Remove solid style
                heartIcon.classList.add('far');    // Add outline style
            }
            
        }else{
            $('#userLoginModal').modal('show');    
        }
    }); 
}
// Owl Slider
$(document).ready(function() {
    // Car Card Slider
    $('.cars_slider').owlCarousel({
        items: 4,
        loop: false,
        margin: 20,
        autoplay: false,
        autoplayTimeout: 3500,
        autoplayHoverPause: true,
        responsiveClass: true,
        dots: false,
        responsive: {
            0: {
                items: 2,
                nav: false,
                margin: 8,
                autoplay: false,
                dots: true,
            },
            600: {
                items: 2,
            },
            1000: {
                items: 3
            },
            1200: {
                items: 4
            }
        },
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
    });

    // Car Card Slider
    $('.popular_cars_slider').owlCarousel({
        items: 4,
        loop: false,
        margin: 20,
        autoplay: false,
        autoplayTimeout: 3500,
        autoplayHoverPause: true,
        responsiveClass: true,
        dots: false,
        responsive: {
            0: {
                items: 2,
                nav: false,
                margin: 8,
                autoplay: false,
                        dots: true,
            },
            600: {
                items: 2,
            },
            1000: {
                items: 3
            },
            1200: {
                items: 4
            }
        },
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
    });

    // Lifestyle Car Card Slider
    $('.lifestyle_cars_slider').owlCarousel({
        items: 4,
        loop: false,
        margin: 20,
        autoplay: false,
        autoplayTimeout: 3500,
        autoplayHoverPause: true,
        responsiveClass: true,
        dots: false,
        responsive: {
            0: {
                items: 2,
                nav: false,
                margin: 8,
                autoplay: false,
                        dots: true,
            },
            600: {
                items: 2,
            },
            1000: {
                items: 3
            },
            1200: {
                items: 4
            }
        },
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
    });

    // Montrose Card Slider
    $('.montros_cars_slider').owlCarousel({
        items: 4,
        loop: false,
        margin: 20,
        autoplay: false,
        autoplayTimeout: 3500,
        autoplayHoverPause: true,
        responsiveClass: true,
        dots: false,
        responsive: {
            0: {
                items: 2,
                nav: false,
                margin: 8,
                autoplay: false,
                        dots: true,
            },
            600: {
                items: 2,
            },
            1000: {
                items: 3
            },
            1200: {
                items: 4
            }
        },
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
    });

    // Body Car Card Slider
    $('.body_cars_slider').owlCarousel({
        items: 4,
        loop: false,
        margin: 20,
        autoplay: false,
        autoplayTimeout: 3500,
        autoplayHoverPause: true,
        responsiveClass: true,
        dots: false,
        responsive: {
            0: {
                items: 2,
                nav: false,
                margin: 8,
                autoplay: false,
                        dots: true,
            },
            600: {
                items: 2,
            },
            1000: {
                items: 3
            },
            1200: {
                items: 4
            }
        },
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
    });

    // Trusted Used Cars by Price
    $('.trusetd_cars_slider').owlCarousel({
        items: 4,
        loop: false,
        margin: 20,
        autoplay: false,
        autoplayTimeout: 3500,
        autoplayHoverPause: true,
        responsiveClass: true,
        dots: false,
        responsive: {
            0: {
                items: 2,
                nav: false,
                margin: 8,
                dots: true,
            },
            600: {
                items: 2,
            },
            1000: {
                items: 3
            },
            1200: {
                items: 3
            },
            1500: {
                items: 4
            }
        },
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
    });
    $('.montros_cars_slider').owlCarousel({
        items: 4,
        loop: false,
        margin: 20,
        autoplay: false,
        autoplayTimeout: 3500,
        autoplayHoverPause: true,
        responsiveClass: true,
        dots: false,
        responsive: {
            0: {
                items: 2,
                nav: false,
                margin: 8,
                autoplay: false,
                        dots: true,
            },
            600: {
                items: 2,
            },
            1000: {
                items: 3
            },
            1200: {
                items: 4
            }
        },
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
    });

    // Tabs Slider
    $('.slider_thumb').owlCarousel({
        items: 4,
        loop: false,
        margin: 16,
        autoplay: false,
        autoplayTimeout: 3500,
        autoplayHoverPause: true,
        responsiveClass: true,
        dots: false,
        responsive: {
            0: {
                items: 3,
                nav: false,
                autoplay: false,
                margin: 8
            },
            600: {
                items: 5,
                autoplay: false
            },
            1000: {
                items: 4,
                autoplay: false
            },
            1200: {
                items: 5,
                autoplay: false
            }
        },
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
    });

    // Recommended Cars
    $('.cars_recommended_slider').owlCarousel({
        items: 4,
        loop: false,
        margin: 20,
        autoplay: false,
        autoplayTimeout: 3500,
        autoplayHoverPause: true,
        responsiveClass: true,
        dots: false,
        responsive: {
            0: {
                items: 2,
                nav: false,
                margin: 8
            },
            600: {
                items: 1,
            },
            1000: {
                items: 2,
                margin: 12,
            },
            1200: {
                items: 2,
                margin: 20,
            }
        },
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
    });
});

// Car slider with thumbnail
$(document).ready(function() {
    var bigimage = $("#big");
    var thumbs = $("#thumbs");
    //var totalslides = 10;
    var syncedSecondary = true;
  
    bigimage
      .owlCarousel({
      items: 1,
      slideSpeed: 2000,
      nav: false,
      autoplay: false,
      dots: false,
      loop: true,
      responsiveRefreshRate: 200,
    //   navText: [
    //     '<i class="fa fa-arrow-left" aria-hidden="true"></i>',
    //     '<i class="fa fa-arrow-right" aria-hidden="true"></i>'
    //   ]
    })
      .on("changed.owl.carousel", syncPosition);
  
    thumbs
      .on("initialized.owl.carousel", function() {
      thumbs
        .find(".owl-item")
        .eq(0)
        .addClass("current");
    })
      .owlCarousel({
        items: 5,
        dots: false,
        nav: true,
        navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"],
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
                margin: 8,
            },
            1000: {
                items: 5,
                margin: 8,
            },
            1200: {
                items: 5
            }
        },
    })
      .on("changed.owl.carousel", syncPosition2);
  
    function syncPosition(el) {
      var count = el.item.count - 1;
      var current = Math.round(el.item.index - el.item.count / 2 - 0.5);
  
      if (current < 0) {
        current = count;
      }
      if (current > count) {
        current = 0;
      }
      thumbs
        .find(".owl-item")
        .removeClass("current")
        .eq(current)
        .addClass("current");
      var onscreen = thumbs.find(".owl-item.active").length - 1;
      var start = thumbs
      .find(".owl-item.active")
      .first()
      .index();
      var end = thumbs
      .find(".owl-item.active")
      .last()
      .index();
  
      if (current > end) {
        thumbs.data("owl.carousel").to(current, 100, true);
      }
      if (current < start) {
        thumbs.data("owl.carousel").to(current - onscreen, 100, true);
      }
    }
  
    function syncPosition2(el) {
      if (syncedSecondary) {
        var number = el.item.index;
        bigimage.data("owl.carousel").to(number, 100, true);
      }
    }
  
    thumbs.on("click", ".owl-item", function(e) {
      e.preventDefault();
      var number = $(this).index();
      bigimage.data("owl.carousel").to(number, 300, true);
    });
  });

//   Profile Picture
$(document).ready(function() {
    var readURL = function(input) {
        if (input.files && input.files[0]) {
            var reader = new FileReader();
            reader.onload = function (e) {
                $('.profile-pic').attr('src', e.target.result);
            }
            reader.readAsDataURL(input.files[0]);
            saveProfilePic()
        }
    }
    $(".file-upload").on('change', function(){
        readURL(this);
    });
    $(".upload-button").on('click', function() {
       $(".file-upload").click();
    });
});

function saveProfilePic(){
    var formData = new FormData($('#user_profile_form')[0]);
    url = $('#user_profile_form').attr('action');
    uploadajax(url, formData, 'post', '', 'json', function(output) {
       
    });
}


  
  let sliderOne = document.getElementById("slider-1");
  let sliderTwo = document.getElementById("slider-2");
  let displayValOne = document.getElementById("range1");
  let displayValTwo = document.getElementById("range2");
  let minGap = 0;
  let sliderTrack = document.querySelector(".slider-track");
  if(sliderTrack)
    var sliderMaxValue = document.getElementById("slider-1").max;
  
  function slideOne() {
    if (parseInt(sliderTwo.value) - parseInt(sliderOne.value) <= minGap) {
      sliderOne.value = parseInt(sliderTwo.value) - minGap;
    }
    displayValOne.textContent = sliderOne.value;
    fillColor();
  }
  function slideTwo() {
    if (parseInt(sliderTwo.value) - parseInt(sliderOne.value) <= minGap) {
      sliderTwo.value = parseInt(sliderOne.value) + minGap;
    }
    displayValTwo.textContent = sliderTwo.value;
    fillColor();
  }
  function fillColor() {
    percent1 = (sliderOne.value / sliderMaxValue) * 100;
    percent2 = (sliderTwo.value / sliderMaxValue) * 100;
    sliderTrack.style.background = `linear-gradient(to right, var(--gray) ${percent1}% , var(--primary) ${percent1}% , var(--primary) ${percent2}%, var(--gray) ${percent2}%)`;
  }


//   Listing Filter Search
$(document).ready(function(){
    function filterList(input, list) {
      var filter = $(input).val().toLowerCase();
      $(list + ' li').filter(function() {
        $(this).toggle($(this).text().toLowerCase().indexOf(filter) > -1);
      });
    }
  
    $('#makesearch').on('input', function() {
      filterList(this, '#makeListsearch');
    });
  
    $('#modelsearch').on('input', function() {
      filterList(this, '#modelListsearch');
    });
    $('#enginesearch').on('input', function() {
        filterList(this, '#enginesearchlist');
      });

    $('#trimsearch').on('input', function() {
        filterList(this, '#trimlistsearch');
    });
  
    $('#exteriorsearch').on('input', function() {
      filterList(this, '#exteriorListsearch');
    });
    $('#interiorsearch').on('input', function() {
        filterList(this, '#interiorListsearch');
      });
    $('#highvaluefeaturesearch').on('input', function() {
    filterList(this, '#highvaluefeaturelist');
    });
  });

var triggerobj = null; // More appropriate initialization

function updateUserProfile(user, fav, profile){
    $('.nav_auth').html(`
        <a href="${fav}" class="nav_auth_heart"><i class="fa-regular fa-heart"></i></a>
        <a href="${profile}" class="nav_auth_login"><i class="fa-regular fa-user me-lg-3 me-2"></i>Profile</a>
    `);
    if (triggerobj) {
        $(triggerobj).trigger('click');
    }
}

function makeFavourite(obj, vid, vin, url){
    var formData = {vid: vid, vin: vin};
    runajax(url, formData, 'get', '', 'json', function(output) {
        const checkbox = document.getElementById('btn-check_' + vin); // Ensure usage if needed
        const heartIcon = document.getElementById('heart-icon_' + vin);
        
        if (heartIcon && output.success) {  // Check if heartIcon exists and output is successful
            if (output.data.status === 1) { // Use strict equality
                console.log('far');
                heartIcon.classList.remove('far'); // Remove outline style
                heartIcon.classList.add('fas');    // Add solid style
            } else {
                console.log('fas');
                heartIcon.classList.remove('fas'); // Remove solid style
                heartIcon.classList.add('far');    // Add outline style
            }
        } else {
            triggerobj = $(obj); // Ensure that triggerobj is a jQuery object
            $('#userLoginModal').modal('show');    
        }
    }); 
}

// Subscription toggle
document.addEventListener('DOMContentLoaded', function() {
    var toggleButtons = document.querySelectorAll('.toggleButton');
    toggleButtons.forEach(function(button) {
        button.addEventListener('click', function() {
            var parentDiv = this.closest('.featureCollapse');
            if (parentDiv.offsetHeight === 340) {
                parentDiv.style.transition = 'height 0.3s ease-in-out';
                parentDiv.style.height = 'auto';
                this.innerHTML = 'Less..';
            } else {
                parentDiv.style.transition = 'height 0.3s ease-in-out';
                parentDiv.style.height = '340px';
                this.innerHTML = 'More..';
            }
        });
    });
});
$('.testimonials_slider').owlCarousel({
    items: 1,
    loop: true,
    margin: 20,
    autoplay: false,
    autoplayTimeout: 3500,
    autoplayHoverPause: true,
    responsiveClass: true,
    dots: false,
    responsive: {
        0: {
            items: 1,
            nav: false,
            // dots: true,
        },
        600: {
            items: 1,
        }
    },
    nav: true,
    navText: ["<i class='fa-solid fa-angle-left'></i>","<i class='fa-solid fa-angle-right'></i>"]
});


    