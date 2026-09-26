"
I am the Metacello baseline of TapeDeck, the Pharo analysis lab for pi tapes.

Packages, each loadable after the ones before it:
- TapeDeck-Core: sessions, runs, steps, tool calls, harness states, stores and tapes
- TapeDeck-Analysis: policies, variants, alignments, comparison tables, statistics
- TapeDeck-Server: the runner HTTP client and the image's own JSON server
- TapeDeck-Inspector: Pharo inspector (Spec 2) views
- TapeDeck-Tests: SUnit tests against the fixture store
- TapeDeck-GT: Glamorous Toolkit views

Groups: 'default' is everything but TapeDeck-GT (plain Pharo 13); 'gt' adds the GT views.

	Metacello new
		baseline: 'TapeDeck';
		repository: 'tonel:///abs/path/to/tapedeck/image/src';
		load: #( 'default' )
"
Class {
	#name : 'BaselineOfTapeDeck',
	#superclass : 'BaselineOf',
	#category : 'BaselineOfTapeDeck',
	#package : 'BaselineOfTapeDeck'
}

{ #category : 'baselines' }
BaselineOfTapeDeck >> baseline: spec [

	<baseline>
	spec for: #common do: [
		spec
			package: 'TapeDeck-Core';
			package: 'TapeDeck-Analysis' with: [ spec requires: #( 'TapeDeck-Core' ) ];
			package: 'TapeDeck-Server' with: [ spec requires: #( 'TapeDeck-Analysis' ) ];
			package: 'TapeDeck-Inspector' with: [ spec requires: #( 'TapeDeck-Analysis' ) ];
			package: 'TapeDeck-Tests' with: [ spec requires: #( 'TapeDeck-Server' 'TapeDeck-Inspector' ) ];
			package: 'TapeDeck-GT' with: [ spec requires: #( 'TapeDeck-Analysis' ) ].
		spec
			group: 'Core' with: #( 'TapeDeck-Core' 'TapeDeck-Analysis' 'TapeDeck-Server' );
			group: 'default' with: #( 'TapeDeck-Core' 'TapeDeck-Analysis' 'TapeDeck-Server' 'TapeDeck-Inspector' 'TapeDeck-Tests' );
			group: 'gt' with: #( 'default' 'TapeDeck-GT' ) ]
]
