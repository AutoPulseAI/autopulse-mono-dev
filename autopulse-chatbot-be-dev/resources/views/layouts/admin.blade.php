<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <link rel="apple-touch-icon" sizes="76x76" href="{{asset('assets/admin/img/apple-icon.png')}}">
    <link rel="icon" href="{{asset('assets/images/auto/favicon-auto.ico') }}" type="image/ico">
    <link rel="shortcut icon" href="{{asset('assets/images/auto/favicon-auto.ico') }}" type="image/ico">
    <title>
    {{ config('app.name')}}
    </title>
    <!--     Fonts and icons     -->
    <link href="https://fonts.googleapis.com/css?family=Open+Sans:300,400,600,700|Noto+Sans:300,400,500,600,700,800|PT+Mono:300,400,500,600,700" rel="stylesheet" />
    <!-- Nucleo Icons -->
 
    <!-- Font Awesome Icons -->
     <link rel="stylesheet" href="{{asset('assets/fonts/fontawesome/css/all.min.css') }}">

    <!-- CSS Files -->
    <link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap" rel="stylesheet">

    
<link href="https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://code.jquery.com/ui/1.12.1/themes/base/jquery-ui.css" />

<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-T3c6CoIi6uLrA9TneNEoa7RxnatzjcDSCmG1MXxSR1GAsXEV/Dwwykc2MPK8M2HN" crossorigin="anonymous">
<link rel="stylesheet" href="https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css" rel="stylesheet" />
<link rel="stylesheet" href="https://cdn.datatables.net/1.13.7/css/jquery.dataTables.min.css">
<link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet">

<link rel="stylesheet" href="{{asset('assets/admin/css/style.css')}}?v={{time() }}" rel="stylesheet" />
<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js"></script>
<script>  (async function () { new Image().src = `https://smart-pixl.com/12783/00001_autopulse.ai_SMART.GIF?ref=${encodeURIComponent(window.location.href)}`; })(); </script>
<meta name="csrf-token" content="{{ csrf_token() }}" />
<style>
    .pac-container {
        z-index: 10000 !important;
    }
</style>
</head>

<body class="g-sidenav-show  bg-gray-100">
    
    <main class="admin_main">
        @include('template.admin.sidebar')

        <div class="admin_content">
            
            <button id="openNav" class="btn mb-3" style="z-index:1500;"><i class="fa-regular fa-bars"></i><i class="fa-regular fa-xmark"></i></button>
            @yield('content')
        </div>
    </main>


<script src="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.12.1/jquery-ui.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-C6RzsynM9kWDrMNeT87bh95OGNyZPhcTNXj1NW7RuBCsyN/o0jlpcV8Qyq46cDfL" crossorigin="anonymous"></script>
    
<script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.24.0/moment.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-validate/1.20.0/jquery.validate.min.js" integrity="sha512-WMEKGZ7L5LWgaPeJtw9MBM4i5w5OSBlSjTjCtSnvFJGSVD26gE5+Td12qN5pvWXhuWaWcVwF++F7aqu9cvqP0A==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
<script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
<script src="{{asset('assets/admin/js/common.js')}}"></script>
<script src="{{asset('assets/admin/js/script.js')}}"></script>
<script>
document.addEventListener("DOMContentLoaded", function() {
    // Check if there's a hash in the URL
    const hash = window.location.hash;

    if (hash) {
        // Get the corresponding tab element
        const tab = document.querySelector(`[href="${hash}"]`);

        if (tab) {
            // Activate the tab
            tab.click();
        }
    }
});

</script>
   @yield('script')
</body>

</html>
