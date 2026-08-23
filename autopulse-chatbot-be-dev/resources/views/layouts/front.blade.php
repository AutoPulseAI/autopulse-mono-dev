<!DOCTYPE html>
<html lang="en">
<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <meta name="csrf-token" content="{{ csrf_token() }}"/>
       
        <title>@yield('title', 'Autopulse AI | Real-Time Inventory & Custom AI Chatbot for Automotive Dealers')</title>
        <meta name="description" content="@yield('meta_description', 'Autopulse AI provides automotive dealers with AI-powered chatbot technology, real-time live inventory, customized dealer branding, and dealer-specific solutions.Get live in minutes with fully branded, ready-to-use AI technology that enhances customer engagement, increases consumer engagement and increases sales.')">
        <meta property="og:title" content="@yield('title', 'Autopulse AI | Real-Time Inventory & Custom AI Chatbot for Automotive Dealers')" />
        <meta property="og:description" content="@yield('meta_description', 'Autopulse AI provides automotive dealers with AI-powered chatbot technology, real-time live inventory, customized dealer branding, and dealer-specific solutions.Get live in minutes with fully branded, ready-to-use AI technology that enhances customer engagement, increases consumer engagement and increases sales.')" />
        <link rel="stylesheet" href="{{asset('assets/fonts/fontawesome/css/all.min.css') }}">
        <link rel="icon" href="{{asset('assets/images/auto/favicon-auto.ico') }}" type="image/ico">
        <link rel="shortcut icon" href="{{asset('assets/images/auto/favicon-auto.ico') }}" type="image/ico">
        <meta name="google-site-verification" content="jhZXMaIvED3Jyf-ZZ-HqJ4pxeySm3aqooG1n6AdjI7U" />

        <!-- CSS -->
        <link rel="stylesheet" href="{{asset('assets/front/css/bootstrap.min.css') }}">
        <link rel="stylesheet" href="{{asset('assets/front/css/plugins/animation.css') }}">
        <link rel="stylesheet" href="{{asset('assets/front/css/plugins/feature.css') }}">
        <link rel="stylesheet" href="{{asset('assets/front/css/plugins/magnify.min.css') }}">
        <link rel="stylesheet" href="{{asset('assets/front/css/plugins/slick.css') }}">
        <link rel="stylesheet" href="{{asset('assets/front/css/plugins/slick-theme.css') }}">
        <link rel="stylesheet" href="{{asset('assets/front/css/plugins/lightbox.css') }}">
        <link rel="stylesheet" href="{{asset('assets/front/css/plugins/bootstrap-select.min.css') }}">
        <link rel="stylesheet" href="{{asset('assets/front/css/plugins/prism.css') }}">
        <link rel="stylesheet" href="{{asset('assets/front/css/auto-style.css') }}">
        <script src="https://code.jquery.com/jquery-3.1.1.min.js"></script>
    </head>
    <body>
        <!-- start Preloader -->
        @include('template.dealers.include.preloader')
        <!-- End Preloader -->

            @yield('content')                                        
                
            <script src="{{asset('assets/front/js/vendor/modernizr.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/bootstrap.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/popper.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/waypoint.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/wow.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/counterup.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/feather.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/sal.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/masonry.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/imageloaded.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/magnify.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/lightbox.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/slick.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/easypie.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/text-type.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/prism.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/jquery.style.swicher.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/bootstrap-select.min.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/backto-top.js') }}"></script>

            <script src="{{asset('assets/front/js/vendor/js.cookie.js') }}"></script>
            <script src="{{asset('assets/front/js/vendor/jquery-one-page-nav.js') }}"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-validate/1.19.3/jquery.validate.min.js" integrity="sha512-37T7leoNS06R80c8Ulq7cdCDU5MNQBwlYoy1TX/WUsLFC2eYNqtKlV0QjH7r8JpG/S0GUMZwebnVFLPd6SU5yg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
            <!-- Main JS -->
            <script src="{{asset('assets/front/js/main.js') }}"></script>   
            <script src="{{asset('assets/js/common.js') }}"></script>

            @stack('after-scripts')
         
<script>
    $('#request_demo .submit').click(function(e){
        e.preventDefault();
        $('#request_demo .submit').text('Please wait...');
        $('#request_demo .submit').attr('disabled','disabled');
        
        if($('#request_demo').valid())
        {    
            url = '{{route('dealer.requestDemo')}}';

            var formData = new FormData($('#request_demo')[0]);
            
            uploadajax(url, formData, 'post', '', 'json', function(output) {
                // var output = JSON.parse(res);
                $('#request_demo .submit').text('Save Address ');
                $('#request_demo .submit').removeAttr('disabled');
                if (output.success) 
                {
                    $('.successmsgdiv').html('Thank you for showing interest We will contact you soon.')
                    $('#thank_you').modal('show');
                    $('#request_demo')[0].reset();	
                    
                    $('#reqInfoConfirmationModal').model('hide');
                    $('#reqInfoConfirmationModal').modal('show');
                    
                }else{
                    
                    for (var key in output.data){
                    
                        existvalue= $('#'+key).val();
                        jQuery.validator.addMethod(key+"error", function(value, element) {
                            return this.optional(element) || value !== existvalue;
                        }, jQuery.validator.format(output.data[key][0]));
                        $('#'+key).addClass(key+"error");
                        jQuery('#'+key).valid();
                    }
                        
                }
            }); 
        }else{
            $('#request_demo .submit').text('Save');
            $('#request_demo .submit').removeAttr('disabled');
        }
    });
</script>

    </body>
</html>