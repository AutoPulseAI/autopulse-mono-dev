<!DOCTYPE html>
<html lang="en">
<html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>@yield('title', 'Autopulse AI | Real-Time Inventory & Custom AI Chatbot for Automotive Dealers')</title>
        <meta name="description" content="@yield('meta_description', 'Autopulse AI provides automotive dealers with AI-powered chatbot technology, real-time live inventory, customized dealer branding, and dealer-specific solutions.Get live in minutes with fully branded, ready-to-use AI technology that enhances customer engagement, increases consumer engagement and increases sales.')">
        <meta property="og:title" content="@yield('title', 'Autopulse AI | Real-Time Inventory & Custom AI Chatbot for Automotive Dealers')" />
        <meta property="og:description" content="@yield('meta_description', 'Autopulse AI provides automotive dealers with AI-powered chatbot technology, real-time live inventory, customized dealer branding, and dealer-specific solutions.Get live in minutes with fully branded, ready-to-use AI technology that enhances customer engagement, increases consumer engagement and increases sales.')" />
        <meta property="og:image" content="@yield('meta_image', asset('default-image.jpg'))" />
        <meta name="google-site-verification" content="jhZXMaIvED3Jyf-ZZ-HqJ4pxeySm3aqooG1n6AdjI7U" />
        <link rel="stylesheet" href="{{asset('assets/fonts/fontawesome/css/all.min.css') }}">
        <link rel="icon" href="{{asset('favicon.jpeg') }}" type="image/jpeg">
        <link rel="shortcut icon" href="{{asset('favicon.jpeg') }}" type="image/jpeg">
        <meta name="facebook-domain-verification" content="4a36g7esf57o2pdlirp8tq23qz059o" />
        <!-- Css -->
        <link rel="stylesheet" href="{{asset('assets/css/bootstrap.min.css') }}">
        <link rel="stylesheet" href="{{asset('assets/css/owl.carousel.min.css') }}">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/select2/4.0.6-rc.0/css/select2.min.css" rel="stylesheet" />
        <link rel="stylesheet" href="{{asset('assets/css/style.css') }}">

        <link rel="stylesheet" href="{{asset('assets/css/gallary.css') }}">
        <link rel="stylesheet" href="{{asset('assets/css/chat.css') }}">

   
        <script src="https://code.jquery.com/jquery-3.1.1.min.js"></script>
        

           
       
            @yield('content')

          
           
            <script src="{{asset('assets/js/popper.min.js') }}"></script>
            <script src="{{asset('assets/js/bootstrap.bundle.min.js') }}"></script>
           
            
            @stack('after-scripts')
           
           
    </body>
</html>