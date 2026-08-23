<!DOCTYPE html>
<html lang="en">
<html>
    <head>
      
        <link rel="stylesheet" href="{{asset('assets/css/bootstrap.min.css') }}">
        <link rel="stylesheet" href="{{asset('assets/css/owl.carousel.min.css') }}">
      
     
        <link rel="stylesheet" href="{{asset('assets/css/chat.css') }}">

        <!-- <script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script> -->
        <script src="https://code.jquery.com/jquery-3.1.1.min.js"></script>
       
    </head>
    <body>

            @include('template.chat')
            
           
           
            <script src="{{asset('assets/js/owl.carousel.min.js') }}"></script>
            
         
            <!-- <script type="text/javascript"src="//cdn.callrail.com/companies/960081308/d9876ed8cce74e4dde79/12/swap.js"></script>  -->
            
            @stack('after-scripts')
    </body>
</html>