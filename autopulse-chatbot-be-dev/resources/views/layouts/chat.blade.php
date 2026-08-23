<!DOCTYPE html>
<html lang="en">
<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>@yield('title', 'Buy New & Used Cars Online | Affordable Prices & Best Deals on Cars')</title>
        <meta name="description" content="@yield('meta_description', 'Find the best deals on new and used cars online. Browse our extensive inventory of certified pre-owned vehicles, affordable prices, and top car brands. Shop now!')">
        <meta property="og:title" content="@yield('title', 'Buy New & Used Cars Online | Affordable Prices & Best Deals on Cars')" />
        <meta property="og:description" content="@yield('meta_description', 'Find the best deals on new and used cars online. Browse our extensive inventory of certified pre-owned vehicles, affordable prices, and top car brands. Shop now!')" />
        <meta property="og:image" content="@yield('meta_image', asset('default-image.jpg'))" />
        <meta name="google-site-verification" content="jhZXMaIvED3Jyf-ZZ-HqJ4pxeySm3aqooG1n6AdjI7U" />
        <link rel="stylesheet" href="{{asset('assets/fonts/fontawesome/css/all.min.css') }}">
        <link rel="icon" href="{{asset('favicon.jpeg') }}" type="image/jpeg">
        <link rel="shortcut icon" href="{{asset('favicon.jpeg') }}" type="image/jpeg">
        <!-- Css -->
        <link rel="stylesheet" href="{{asset('assets/css/bootstrap.min.css') }}">
        <link rel="stylesheet" href="{{asset('assets/css/owl.carousel.min.css') }}">
        <!-- <link href="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.0/css/select2.min.css" rel="stylesheet" /> -->
        <!-- <link rel="stylesheet" href="{{asset('assets/css/style.css') }}"> -->

        <link rel="stylesheet" href="{{asset('assets/css/gallary.css') }}">
        <link rel="stylesheet" href="{{asset('assets/css/chat.css') }}">

        <!-- <script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script> -->
        <script src="https://code.jquery.com/jquery-3.1.1.min.js"></script>
       
    </head>
    <body>

            @include('template.chat')
            
           
            <script src="{{asset('assets/js/popper.min.js') }}"></script>
            <script src="{{asset('assets/js/bootstrap.bundle.min.js') }}"></script>
            <script src="{{asset('assets/js/owl.carousel.min.js') }}"></script>
            
            <script src="{{asset('assets/js/share.js') }}"></script>
            <script src="{{asset('assets/js/gallary.js') }}"></script>
            <!-- <script type="text/javascript"src="//cdn.callrail.com/companies/960081308/d9876ed8cce74e4dde79/12/swap.js"></script>  -->
            
            @stack('after-scripts')
    </body>
</html>