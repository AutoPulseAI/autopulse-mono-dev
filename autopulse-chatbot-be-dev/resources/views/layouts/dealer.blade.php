<!DOCTYPE html>
<html lang="en">
<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <meta name="csrf-token" content="{{ csrf_token() }}"/>
       
        <title>@yield('title', 'Buy New & Used Cars Online | Affordable Prices & Best Deals on Cars')</title>
        <meta name="description" content="@yield('meta_description', 'Find the best deals on new and used cars online. Browse our extensive inventory of certified pre-owned vehicles, affordable prices, and top car brands. Shop now!')">
        <meta property="og:title" content="@yield('title', 'Buy New & Used Cars Online | Affordable Prices & Best Deals on Cars')" />
        <meta property="og:description" content="@yield('meta_description', 'Find the best deals on new and used cars online. Browse our extensive inventory of certified pre-owned vehicles, affordable prices, and top car brands. Shop now!')" />
        <link rel="stylesheet" href="{{asset('assets/fonts/fontawesome/css/all.min.css') }}">
        <link rel="icon" href="{{asset('assets/images/auto/favicon-auto.ico') }}" type="image/ico">
        <link rel="shortcut icon" href="{{asset('assets/images/auto/favicon-auto.ico') }}" type="image/ico">
        <meta name="google-site-verification" content="jhZXMaIvED3Jyf-ZZ-HqJ4pxeySm3aqooG1n6AdjI7U" />
    <!-- Css -->
        <link rel="stylesheet" href="{{asset('assets/css/bootstrap.min.css') }}">
        <link rel="stylesheet" href="{{asset('assets/css/owl.carousel.min.css') }}">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.0/css/select2.min.css" rel="stylesheet" />
        <link rel="stylesheet" href="{{asset('assets/css/gallary.css') }}">
        <link rel="stylesheet" href="{{asset('assets/css/auto-auth.css') }}">
        <!-- <link rel="stylesheet" href="{{asset('assets/css/style.css') }}"> -->
        <script src="https://code.jquery.com/jquery-3.1.1.min.js"></script>
      
    </head>
    <body>
    <style>
    .pac-container {
        z-index: 10000 !important;
    }
</style>



           
       
            @yield('content')                                        
                                            

            
            <script src="{{asset('assets/js/popper.min.js') }}"></script>
            <script src="{{asset('assets/js/bootstrap.bundle.min.js') }}"></script>
            <script src="{{asset('assets/js/owl.carousel.min.js') }}"></script>
            <script src="{{asset('assets/js/offcanvas.js') }}"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.0/js/select2.min.js"></script>
            <script src="{{asset('assets/js/script.js') }}"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-validate/1.19.3/jquery.validate.min.js" integrity="sha512-37T7leoNS06R80c8Ulq7cdCDU5MNQBwlYoy1TX/WUsLFC2eYNqtKlV0QjH7r8JpG/S0GUMZwebnVFLPd6SU5yg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
            <script src="{{asset('assets/js/common.js') }}"></script>
           
            @stack('after-scripts')
            <!-- Start of HubSpot Embed Code -->

          

            <!-- End of HubSpot Embed Code -->
    </body>
</html>